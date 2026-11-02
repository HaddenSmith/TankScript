
import { Arena } from './arena';
import { createTankScriptApi } from '../tank-script/tankScriptApi';
import { executeTankScript } from '../tank-script/tankScriptExecutor';

export class BattleEngine {
  #lastTickEvents = [];
  #tickCount = 0;
  #lastProgressTick = 0;

  static MAX_TICKS = 1000;
  static MAX_NO_PROGRESS_TICKS = 200;

  constructor(width, height) {
    this.arena = new Arena(width, height);
    this.nextBulletId = 1;
  }

  tick() {
    this.#lastTickEvents = [];

    const requestedCommands = this.#collectCommands();
    const resolvedCommands = this.#resolveMovementCommands(requestedCommands);

    this.#moveBullets();
    this.#executeCommands(resolvedCommands);
    this.#resolveBulletTankCollisions();

    this.#tickCount++;

    return this.#getBattleResult();
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

  #collectCommands() {
    const allCommands = {};

    this.arena.tanks.forEach((tank) => {
      try {
        if (!tank.isAlive()) return;

        const api = createTankScriptApi();
        const tankState = this.#createTankState(tank);
        executeTankScript(tank.code, api, tankState);

        allCommands[tank.id] = api.getSubmittedCommand()?.action;
      } catch (error) {
        console.error(`${tank.name} failed:`, error);
      }
    });

    return allCommands;
  }

  #createTankState(tank) {
    return Object.freeze({
      tankId: tank.id,
      tankPosition: Object.freeze({ x: tank.x, y: tank.y }),
      tankRotation: tank.rotation,
      tankHealth: tank.health,
      allTanks: Object.freeze(this.arena.tanks.map((arenaTank) => Object.freeze({
        id: arenaTank.id,
        name: arenaTank.name,
        x: arenaTank.x,
        y: arenaTank.y,
        rotation: arenaTank.rotation,
        health: arenaTank.health,
      }))),
      allBullets: Object.freeze(this.arena.bullets.map((bullet) => Object.freeze({
        id: bullet.id,
        ownerId: bullet.ownerId,
        x: bullet.x,
        y: bullet.y,
        rotation: bullet.rotation,
      }))),
      arenaWidth: this.arena.width,
      arenaHeight: this.arena.height,
    });
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
      // Block movement outside the arena.
      if (this.arena.isOutOfBounds(destination)) {
        blockList.add(moveIntent.tankId);
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

    this.arena.bullets.forEach((bullet) => {
      bullet.move();

      if (this.arena.isOutOfBounds(bullet)) {
        bulletIdsToRemove.add(bullet.id);
        return;
      }
    });

    const reportedCollisions = new Set();

    for (let firstIndex = 0; firstIndex < this.arena.bullets.length; firstIndex += 1) {
      const bullet1 = this.arena.bullets[firstIndex];

      for (let secondIndex = firstIndex + 1; secondIndex < this.arena.bullets.length; secondIndex += 1) {
        const bullet2 = this.arena.bullets[secondIndex];

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

    // Remove all marked bullets.
    for (const bulletId of bulletIdsToRemove) {
      this.arena.removeBullet(bulletId);
    }
  }

  #resolveBulletTankCollisions() {
    const bulletIdsToRemove = new Set();

    this.arena.bullets.forEach((bullet) => {
      this.arena.tanks.forEach((tank) => {
        if (bullet.isCollidingWithTank(tank) && tank.isAlive()) {
          bulletIdsToRemove.add(bullet.id);

          tank.takeDamage();

          // Taking damage counts as meaningful progress.
          // Since #tickCount increments after collisions,
          // record this damage as occurring on the next tick number.
          this.#lastProgressTick = this.#tickCount + 1;

          if (!tank.isAlive()) {
            this.#lastTickEvents.push({
              type: 'tank-destroyed',
              x: tank.x,
              y: tank.y,
            });

            const bulletOwner = this.arena.tanks.find((arenaTank) => arenaTank.id === bullet.ownerId);

            bulletOwner?.addKill();
          }
        }
      });
    });

    // Remove all marked bullets.
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

    const mostKills = Math.max(...aliveTanks.map((tank) => tank.kills));

    // No kills means nobody has earned a timeout victory.
    if (mostKills === 0) return null;

    const leaders = aliveTanks.filter((tank) => tank.kills === mostKills);

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
