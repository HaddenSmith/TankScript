import { Arena } from './arena';
import { createTankScriptApi } from '../tank-script/tankScriptApi';
import { executeTankScript } from '../tank-script/tankScriptExecutor';

export class BattleEngine {
  #lastTickEvents = [];
  #tickCount = 0;
  #lastProgressTick = 0;

  static MAX_TICKS = 1000;
  static MAX_NO_PROGRESS_TICKS = 125;

  constructor(width, height) {
    this.arena = new Arena(width, height);
    this.nextBulletId = 1;
  }

  // Synchronous entry point for trusted fixtures and development benchmarks.
  tick() {
    return this.resolveTick(this.#collectCommands());
  }

  resolveTick(requestedCommands) {
    this.#lastTickEvents = [];

    const allTankStartingPositions = new Map();
    for (const tank of this.arena.tanks) {
      allTankStartingPositions.set(tank.id, { x: tank.x, y: tank.y });
    }

    const movedBulletIds = this.#moveBullets();
    const resolvedCommands = this.#resolveMovementCommands({ ...requestedCommands });

    this.#executeCommands(resolvedCommands);
    this.#resolveBulletTankCollisions(allTankStartingPositions);
    this.#resolveBulletBulletCollisions(movedBulletIds);

    this.#tickCount++;

    return this.#getBattleResult();
  }

  debugGenerateCommand(allTanks, allBullets, tankCode, tankId) {
    allTanks.forEach((tank) => this.arena.addTank(tank));
    allBullets.forEach((bullet) => this.arena.addBullet(bullet));

    const tank = this.arena.getTankById(tankId);
    if (!tank) {
      throw new Error(`Cannot generate a command: tank ${tankId} is not in the scenario.`);
    }

    const api = createTankScriptApi();
    const [tankState] = this.#createTankStates([tank]);
    executeTankScript(tankCode, api, tankState);

    return api.getSubmittedCommand();
  }

  getLastTickEvents() {
    return this.#lastTickEvents.map((event) => ({ ...event }));
  }

  getTickCount() {
    return this.#tickCount;
  }

  addTank(tank) {
    this.arena.addTank(tank);
  }

  getTankScriptStates() {
    return this.#createTankStates(this.arena.tanks.filter((tank) => tank.isAlive()));
  }

  #collectCommands() {
    const allCommands = {};

    for (const tankState of this.getTankScriptStates()) {
      const tank = this.arena.getTankById(tankState.tankId);
      try {
        const api = createTankScriptApi();
        executeTankScript(tank.code, api, tankState);

        allCommands[tank.id] = api.getSubmittedCommand()?.action;
      } catch (error) {
        console.error(`${tank.name} failed:`, error);
      }
    }

    return allCommands;
  }

  #createTankStates(tanks) {
    // All decisions see the same immutable arena before resolution begins.
    const allTanks = Object.freeze(this.arena.tanks.map((tank) => Object.freeze({
      id: tank.id,
      name: tank.name,
      x: tank.x,
      y: tank.y,
      rotation: tank.rotation,
      health: tank.health,
    })));
    const allBullets = Object.freeze(this.arena.bullets.map((bullet) => Object.freeze({
      id: bullet.id,
      ownerId: bullet.ownerId,
      x: bullet.x,
      y: bullet.y,
      rotation: bullet.rotation,
    })));

    return tanks.map((tank) => Object.freeze({
      tankId: tank.id,
      tankPosition: Object.freeze({ x: tank.x, y: tank.y }),
      tankRotation: tank.rotation,
      tankHealth: tank.health,
      allTanks,
      allBullets,
      arenaWidth: this.arena.width,
      arenaHeight: this.arena.height,
    }));
  }

  #createMoveIntent(tank, command) {
    const moveIntent = { tankId: tank.id, fromX: tank.x, fromY: tank.y };

    switch (command) {
      case 'moveUp':
        moveIntent.toX = tank.x;
        moveIntent.toY = tank.y - 1;
        break;
      case 'moveDown':
        moveIntent.toX = tank.x;
        moveIntent.toY = tank.y + 1;
        break;
      case 'moveRight':
        moveIntent.toX = tank.x + 1;
        moveIntent.toY = tank.y;
        break;
      case 'moveLeft':
        moveIntent.toX = tank.x - 1;
        moveIntent.toY = tank.y;
        break;
    }

    return moveIntent;
  }

  #resolveMovementCommands(commands) {
    const moveIntents = [];
    const blockList = new Set();

    // Build all movement intents.
    this.arena.tanks.forEach((tank) => {
      if (!tank.isAlive()) return;

      const command = commands[tank.id];
      if (!command || !command.startsWith('move')) return;

      const moveIntent = this.#createMoveIntent(tank, command);

      const destination = {
        x: moveIntent.toX,
        y: moveIntent.toY,
      };

      // CASE 1:
      // An attempted boundary move causes damage even though it is blocked.
      if (this.arena.isTankOutOfBounds(destination)) {
        blockList.add(moveIntent.tankId);
        tank.takeDamage();
        this.#lastProgressTick = this.#tickCount + 1;

        if (!tank.isAlive()) {
          this.#lastTickEvents.push({
            type: 'tank-destroyed',
            x: tank.x,
            y: tank.y,
          });
        }
      }

      moveIntents.push(moveIntent);
    });

    // Compare movement intents against each other.
    for (const intent1 of moveIntents) {
      for (const intent2 of moveIntents) {
        if (intent1 === intent2) continue;

        // CASE 2:
        // Two tanks want the same destination.
        if (intent1.toX === intent2.toX && intent1.toY === intent2.toY) {
          blockList.add(intent1.tankId);
          blockList.add(intent2.tankId);
        }

        // CASE 3:
        // Two tanks attempt to swap positions.
        if (intent1.fromX === intent2.toX && intent1.fromY === intent2.toY &&
          intent2.fromX === intent1.toX && intent2.fromY === intent1.toY) {
          blockList.add(intent1.tankId);
          blockList.add(intent2.tankId);
        }
      }

      // CASE 4 / CASE 5:
      // Check whether another tank currently occupies this destination.
      this.arena.tanks.forEach((tank) => {
        if (tank.x === intent1.toX && tank.y === intent1.toY && tank.id !== intent1.tankId) {
          const tankIsMoving = moveIntents.some(
            (intent) => intent.tankId === tank.id
          );

          // If the occupying tank is NOT moving away,
          // block this movement.
          if (!tankIsMoving) blockList.add(intent1.tankId);
        }
      });
    }

    // CASE 6:
    // Propagate blocked movement through chains of occupied positions.
    // If the tank occupying a destination cannot move away,
    // block the tank trying to move into its position.
    let blockListChanged = true;

    while (blockListChanged) {
      blockListChanged = false;

      for (const intent of moveIntents) {
        if (blockList.has(intent.tankId)) continue;

        const occupyingTank = this.arena.getTankAtPosition(intent.toX, intent.toY);
        if (!occupyingTank) continue;

        const occupyingTankIntent = moveIntents.find((moveIntent) => moveIntent.tankId === occupyingTank.id);

        if (!occupyingTankIntent || blockList.has(occupyingTank.id)) {
          blockList.add(intent.tankId);
          blockListChanged = true;
        }
      }
    }

    // Remove all blocked movement commands.
    for (const blockedId of blockList) {
      delete commands[blockedId];
    }

    return commands;
  }

  #executeCommands(allCommands) {
    Object.entries(allCommands).forEach(([tankId, command]) => {
      const tank = this.arena.getTankById(Number(tankId));

      if (tank) {
        switch (command) {
          case 'moveUp':
            tank.moveUp();
            break;
          case 'moveDown':
            tank.moveDown();
            break;
          case 'moveRight':
            tank.moveRight();
            break;
          case 'moveLeft':
            tank.moveLeft();
            break;
          case 'rotateRight':
            tank.rotateRight();
            break;
          case 'rotateLeft':
            tank.rotateLeft();
            break;
          case 'shoot':
            this.arena.addBullet(tank.shoot(this.nextBulletId++));
            break;
        }
      }
    });
  }

  #moveBullets() {
    const bulletIdsToRemove = new Set();
    const movedBulletIds = new Set();

    this.arena.bullets.forEach((bullet) => {
      bullet.move();

      if (this.arena.isBulletOutOfBounds(bullet)) {
        bulletIdsToRemove.add(bullet.id);
      } else {
        movedBulletIds.add(bullet.id);
      }
    });

    for (const bulletId of bulletIdsToRemove) {
      this.arena.removeBullet(bulletId);
    }

    return movedBulletIds;
  }


  #resolveBulletTankCollisions(allTankStartingPositions) {
    const bulletIdsToRemove = new Set();
    const tankHits = new Map();

    // PHASE 1:
    // Record every hit first so lethal hits do not hide simultaneous hits.
    this.arena.bullets.forEach((bullet) => {
      // Bullets move first, so a following tank cannot take the hit meant
      // for the tank that started at the bullet's arrival cell.
      const originalOccupant = this.arena.tanks.find((tank) => {
        if (!tank.isAlive()) return false;

        const startingPosition = allTankStartingPositions.get(tank.id);
        if (!startingPosition) return false;

        return startingPosition.x === bullet.x && startingPosition.y === bullet.y;
      });

      for (const tank of this.arena.tanks) {
        if (!tank.isAlive()) continue;
        if (originalOccupant && tank !== originalOccupant) continue;

        const startingPosition = allTankStartingPositions.get(tank.id);
        let crossesTankPath = false;

        // With movement on one axis, these ranges include only the path
        // and its endpoints, including the tank's starting cell.
        if (startingPosition) {
          crossesTankPath =
            bullet.x >= Math.min(startingPosition.x, tank.x) &&
            bullet.x <= Math.max(startingPosition.x, tank.x) &&
            bullet.y >= Math.min(startingPosition.y, tank.y) &&
            bullet.y <= Math.max(startingPosition.y, tank.y);
        }

        if (!bullet.isCollidingWithTank(tank) && !crossesTankPath) continue;

        bulletIdsToRemove.add(bullet.id);

        if (!tankHits.has(tank.id)) {
          tankHits.set(tank.id, {
            tank,
            hitCount: 0,
            bulletOwners: new Set(),
          });
        }

        const hits = tankHits.get(tank.id);
        hits.hitCount++;
        hits.bulletOwners.add(bullet.ownerId);

        break;
      }
    });

    // PHASE 2:
    // Apply damage after all collisions have been recorded.
    for (const { tank, hitCount, bulletOwners } of tankHits.values()) {
      // All bullets count as hits, but health cannot go below zero.
      for (let i = 0; i < hitCount && tank.isAlive(); i++) {
        tank.takeDamage();
      }

      // If the tank was destroyed, report it once and award kills
      // to every distinct owner whose bullet hit simultaneously.
      if (!tank.isAlive()) {
        this.#lastTickEvents.push({
          type: 'tank-destroyed',
          x: tank.x,
          y: tank.y,
        });

        for (const ownerId of bulletOwners) {
          const bulletOwner = this.arena.getTankById(ownerId);

          bulletOwner?.addKill();
        }
      }
    }

    // Record the current tick if any tank took damage.
    if (tankHits.size > 0) this.#lastProgressTick = this.#tickCount + 1;

    // Remove all bullets that hit tanks, including simultaneous hits.
    for (const bulletId of bulletIdsToRemove) {
      this.arena.removeBullet(bulletId);
    }
  }


  #resolveBulletBulletCollisions(movedBulletIds) {
    const bulletIdsToRemove = new Set();
    const reportedCollisions = new Set();
    // Newly fired bullets join these collisions on the next tick.
    const bullets = this.arena.bullets.filter((bullet) => movedBulletIds.has(bullet.id));

    for (let firstIndex = 0; firstIndex < bullets.length; firstIndex += 1) {
      const bullet1 = bullets[firstIndex];

      for (let secondIndex = firstIndex + 1; secondIndex < bullets.length; secondIndex += 1) {
        const bullet2 = bullets[secondIndex];

        if (bullet1.x !== bullet2.x || bullet1.y !== bullet2.y) continue;

        bulletIdsToRemove.add(bullet1.id);
        bulletIdsToRemove.add(bullet2.id);

        const positionKey = `${bullet1.x},${bullet1.y}`;

        if (!reportedCollisions.has(positionKey)) {
          reportedCollisions.add(positionKey);

          this.#lastTickEvents.push({
            type: 'bullet-impact',
            x: bullet1.x,
            y: bullet1.y,
          });
        }
      }
    }

    for (const bulletId of bulletIdsToRemove) {
      this.arena.removeBullet(bulletId);
    }
  }

  #getBattleResult() {
    const aliveTanks = this.arena.tanks.filter((tank) => tank.isAlive());

    // CASE 1:
    // A single surviving tank wins, even on the final permitted tick.
    if (aliveTanks.length === 1) {
      return {
        status: 'win',
        winner: aliveTanks[0],
        reason: 'elimination',
        tickCount: this.#tickCount,
      };
    }

    // CASE 2:
    // All tanks have been destroyed. Nobody wins.
    if (aliveTanks.length === 0) {
      return {
        status: 'tie',
        winner: null,
        reason: 'mutual-destruction',
        tickCount: this.#tickCount,
      };
    }

    // CASE 3:
    // The battle has reached its maximum permitted tick count.
    if (this.#tickCount >= BattleEngine.MAX_TICKS) {
      return this.#getTimeoutResult('timeout');
    }

    // CASE 4:
    // No tank has taken damage for too many consecutive ticks.
    if (this.#noMeaningfulProgress()) {
      return this.#getTimeoutResult('stalemate');
    }

    // The battle is still ongoing.
    return null;
  }

  #noMeaningfulProgress() {
    // Measure elapsed ticks since the most recent tank damage.
    // Movement, shooting, and bullet-to-bullet impacts do not reset this.
    return (
      this.#tickCount - this.#lastProgressTick >=
      BattleEngine.MAX_NO_PROGRESS_TICKS
    );
  }

  #getTimeoutWinner() {
    // Only surviving tanks are eligible to win on kills.
    const aliveTanks = this.arena.tanks.filter((tank) => tank.isAlive());

    if (aliveTanks.length === 0) return null;

    const mostKills = Math.max(...aliveTanks.map((tank) => tank.killCount));

    // No kills means nobody has earned a timeout victory.
    if (mostKills === 0) return null;

    const leaders = aliveTanks.filter((tank) => tank.killCount === mostKills);

    // Multiple tanks tied for the most kills means a draw.
    return leaders.length === 1 ? leaders[0] : null;
  }

  #getTimeoutResult(reason) {
    const winner = this.#getTimeoutWinner();

    return {
      status: winner ? 'win' : 'tie',
      winner,
      reason,
      tickCount: this.#tickCount,
    };
  }
}
