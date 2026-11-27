import { Arena } from './arena.js';
import { createTankScriptApi } from '../tank-script/shared/tankScriptApi.js';
import { executeTankScript } from '../tank-script/javascript/tankScriptExecutor.js';

export class BattleEngine {
  #lastTickEvents = [];
  #tickCount = 0;
  #lastProgressTick = 0;

  static MAX_TICKS = 1000;
  static MAX_NO_PROGRESS_TICKS = 125;

  constructor(width, height, walls = false, powerups = false) {
    this.arena = new Arena(width, height, walls);
    this.nextBulletId = 1;
    this.powerupsEnabled = powerups;
  }

  // Synchronous entry point for trusted fixtures and development benchmarks.
  tick() { return this.resolveTick(this.#collectCommands()); }

  resolveTick(requestedCommands) {
    this.#lastTickEvents = [];

    // Spawn once, after tanks are placed. Hand-built scenarios keep their layout.
    if (this.powerupsEnabled && this.#tickCount === 0 &&
        this.arena.hearts.length === 0 && this.arena.lightnings.length === 0) {
      this.arena.spawnPowerups();
    }

    const allTankStartingPositions = new Map();
    for (const tank of this.arena.tanks) {
      allTankStartingPositions.set(tank.id, { x: tank.x, y: tank.y });
    }

    const allBulletStartingPositions = this.#moveBullets();
    const resolvedCommands = this.#resolveMovementCommands({ ...requestedCommands });

    this.#executeCommands(resolvedCommands);
    this.#resolveBulletTankCollisions(allTankStartingPositions, allBulletStartingPositions);
    this.#resolveBulletBulletCollisions(allBulletStartingPositions);
    // Consume existing effects after this tick's actions, before granting new pickups.
    // Collection on tick N therefore boosts exactly ticks N+1 through N+50.
    for (const tank of this.arena.tanks) tank.advanceLightningTick();
    if (this.powerupsEnabled) this.#collectPowerups();

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

  getLastTickEvents() { return this.#lastTickEvents.map((event) => ({ ...event })); }

  getTickCount() { return this.#tickCount; }

  addTank(tank) { this.arena.addTank(tank); }

  getTankScriptStates() { return this.#createTankStates(this.arena.tanks.filter((tank) => tank.isAlive())); }

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

      // Destructible walls block movement without damaging the tank.
      if (this.arena.isPositionOccupiedByWall(destination.x, destination.y)) {
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
          const tankIsMoving = moveIntents.some((intent) => intent.tankId === tank.id);

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

      if (tank?.isAlive()) {
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
    const allBulletStartingPositions = new Map();
    const wallHits = new Map();

    this.arena.bullets.forEach((bullet) => {
      const startingPosition = { x: bullet.x, y: bullet.y };
      allBulletStartingPositions.set(bullet.id, startingPosition);
      bullet.move();

      // A faster bullet must stop at an original occupant before a wall behind it.
      if (bullet.speed > 0.5) {
        let closestCollision;
        for (const tank of this.arena.tanks) {
          if (!tank.isAlive()) continue;
          const collision = this.#getBulletTankCollision(bullet, startingPosition, tank);
          if (collision && (!closestCollision || collision.distance < closestCollision.distance)) {
            closestCollision = collision;
          }
        }
        if (closestCollision) {
          bullet.x = closestCollision.x;
          bullet.y = closestCollision.y;
        }
      }

      const wall = this.arena.getFirstWallInPath(startingPosition, bullet);
      if (wall) {
        bulletIdsToRemove.add(bullet.id);
        wallHits.set(wall, (wallHits.get(wall) ?? 0) + 1);
      } else if (bullet.speed <= 0.5 && this.arena.isBulletOutOfBounds(bullet)) {
        bulletIdsToRemove.add(bullet.id);
      }
    });

    // Every bullet sees the same living walls, including simultaneous lethal hits.
    for (const [wall, hitCount] of wallHits) {
      wall.takeDamage(hitCount);
    }

    for (const bulletId of bulletIdsToRemove) {
      this.arena.removeBullet(bulletId);
    }

    return allBulletStartingPositions;
  }

  #getBulletTankCollision(bullet, bulletStartingPosition, tank, tankStartingPosition = tank) {
    // Preserve ordinary bullet endpoint checks; faster bullets also sweep their path.
    const start = bullet.speed > 0.5 && bulletStartingPosition ? bulletStartingPosition : bullet;
    const minX = Math.max(Math.min(start.x, bullet.x), Math.min(tankStartingPosition.x, tank.x));
    const maxX = Math.min(Math.max(start.x, bullet.x), Math.max(tankStartingPosition.x, tank.x));
    const minY = Math.max(Math.min(start.y, bullet.y), Math.min(tankStartingPosition.y, tank.y));
    const maxY = Math.min(Math.max(start.y, bullet.y), Math.max(tankStartingPosition.y, tank.y));
    if (minX > maxX || minY > maxY) return null;

    // Both paths use one axis, so their overlapping coordinate ranges give the hit.
    const x = Math.max(minX, Math.min(start.x, maxX));
    const y = Math.max(minY, Math.min(start.y, maxY));
    return { x, y, distance: Math.abs(x - start.x) + Math.abs(y - start.y) };
  }

  #resolveBulletTankCollisions(allTankStartingPositions, allBulletStartingPositions) {
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

      const bulletStartingPosition = allBulletStartingPositions.get(bullet.id);
      let hitTank;
      let closestDistance = Infinity;
      for (const tank of this.arena.tanks) {
        if (!tank.isAlive()) continue;
        if (originalOccupant && tank !== originalOccupant) continue;

        const collision = this.#getBulletTankCollision(
          bullet, bulletStartingPosition, tank, allTankStartingPositions.get(tank.id),
        );
        if (!collision) continue;
        if (collision.distance < closestDistance ||
            (bullet.speed > 0.5 && collision.distance === closestDistance && tank.id < hitTank.id)) {
          hitTank = tank;
          closestDistance = collision.distance;
        }
      }
      if (!hitTank) return;

      bulletIdsToRemove.add(bullet.id);
      if (!tankHits.has(hitTank.id)) {
        tankHits.set(hitTank.id, {
          tank: hitTank,
          hitCount: 0,
          bulletOwners: new Set(),
          hitsByOwner: new Map(),
        });
      }

      const hits = tankHits.get(hitTank.id);
      hits.hitCount++;
      hits.bulletOwners.add(bullet.ownerId);
      hits.hitsByOwner.set(bullet.ownerId, (hits.hitsByOwner.get(bullet.ownerId) ?? 0) + 1);
    });

    // PHASE 2:
    // Apply damage after all collisions have been recorded.
    for (const { tank, hitCount, bulletOwners, hitsByOwner } of tankHits.values()) {
      // All bullets count as hits, but health cannot go below zero.
      for (let i = 0; i < hitCount && tank.isAlive(); i++) {
        tank.takeDamage();
      }

      // Give each bullet owner credit for their own hits.
      for (const [ownerId, hits] of hitsByOwner) {
        const bulletOwner = this.arena.getTankById(ownerId);
        bulletOwner?.addDamageDealt(hits);
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


  #resolveBulletBulletCollisions(allBulletStartingPositions) {
    const bulletIdsToRemove = new Set();
    const reportedCollisions = new Set();
    // Newly fired bullets join these collisions on the next tick.
    const bullets = this.arena.bullets.filter((bullet) => {
      if (!allBulletStartingPositions.has(bullet.id)) return false;
      // Fast bullets can hit tanks on their way out before being discarded.
      if (this.arena.isBulletOutOfBounds(bullet)) {
        bulletIdsToRemove.add(bullet.id);
        return false;
      }
      return true;
    });

    for (let firstIndex = 0; firstIndex < bullets.length; firstIndex += 1) {
      const bullet1 = bullets[firstIndex];

      for (let secondIndex = firstIndex + 1; secondIndex < bullets.length; secondIndex += 1) {
        const bullet2 = bullets[secondIndex];

        const collision = this.#getBulletCollisionPosition(bullet1, bullet2, allBulletStartingPositions);
        if (!collision) continue;

        bulletIdsToRemove.add(bullet1.id);
        bulletIdsToRemove.add(bullet2.id);

        const positionKey = `${collision.x},${collision.y}`;

        if (!reportedCollisions.has(positionKey)) {
          reportedCollisions.add(positionKey);

          this.#lastTickEvents.push({
            type: 'bullet-impact',
            x: collision.x,
            y: collision.y,
          });
        }
      }
    }

    for (const bulletId of bulletIdsToRemove) {
      this.arena.removeBullet(bulletId);
    }
  }

  #getBulletCollisionPosition(bullet1, bullet2, allBulletStartingPositions) {
    if (bullet1.x === bullet2.x && bullet1.y === bullet2.y) return { x: bullet1.x, y: bullet1.y };
    if (bullet1.speed <= 0.5 && bullet2.speed <= 0.5) return null;

    const start1 = allBulletStartingPositions.get(bullet1.id);
    const start2 = allBulletStartingPositions.get(bullet2.id);
    const velocityX = (bullet1.x - start1.x) - (bullet2.x - start2.x);
    const velocityY = (bullet1.y - start1.y) - (bullet2.y - start2.y);
    const offsetX = start2.x - start1.x;
    const offsetY = start2.y - start1.y;
    if (velocityX === 0 && velocityY === 0) return null;
    // Crossing paths cancel bullets only when they meet at the same time.
    if (offsetX * velocityY !== offsetY * velocityX) return null;
    const time = velocityX !== 0 ? offsetX / velocityX : offsetY / velocityY;
    if (time <= 0 || time > 1) return null;
    return {
      x: start1.x + (bullet1.x - start1.x) * time,
      y: start1.y + (bullet1.y - start1.y) * time,
    };
  }

  #collectPowerups() {
    // Damage resolves first: pickups cannot revive a destroyed tank.
    // Hearts restore 1 HP; lightning refreshes the next 50 ticks, without stacking.
    for (const tank of this.arena.tanks) {
      if (!tank.isAlive()) continue;
      const heart = this.arena.getHeartByPosition(tank.x, tank.y);
      if (heart) {
        tank.heal();
        this.arena.removeHeart(heart);
      }
      const lightning = this.arena.getLightningByPosition(tank.x, tank.y);
      if (lightning) {
        tank.lightningPowerup(true);
        this.arena.removeLightning(lightning);
      }
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
