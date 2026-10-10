import { Arena } from './arena';
import { createTankScriptApi } from '../tank-script/tankScriptApi';
import { executeTankScript } from '../tank-script/tankScriptExecutor';

export class BattleEngine {
  constructor(width, height) {
    this.arena = new Arena(width, height);
    this.nextBulletId = 1;
  }

  tick() {
    const requestedCommands = this.#collectCommands();

    const resolvedCommands = this.#resolveMovementCommands(requestedCommands);

    this.#moveBullets();

    this.#executeCommands(resolvedCommands);

    this.#resolveBulletTankCollisions();
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
    let moveIntent = { tankId: tank.id, fromX: tank.x, fromY: tank.y };
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
      if (this.arena.isOutOfBounds(destination)) blockList.add(moveIntent.tankId);

      moveIntents.push(moveIntent);
    });

    // Compare movement intents against each other.
    for (const intent1 of moveIntents) {
      for (const intent2 of moveIntents) {
        if (intent1 === intent2) continue;

        // CASE 2:
        // Two tanks want the same destination.
        if (intent1.toX === intent2.toX && intent1.toY === intent2.toY ) {
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

    // Remove bullets that collide at the same position.
      this.arena.bullets.forEach((bullet1) => {
        this.arena.bullets.forEach((bullet2) => {
          if (bullet1.id === bullet2.id) return;
          if (bullet1.x === bullet2.x && bullet1.y === bullet2.y) {
            bulletIdsToRemove.add(bullet1.id);
            bulletIdsToRemove.add(bullet2.id)
          }
        });
      });

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
            bulletIdsToRemove.add(bullet.id)
            tank.takeDamage();

            if (!tank.isAlive()) {
              console.log(`${tank.name} has been destroyed!`);
              // Do other things like dont display the tank, etc..? Remove it from the arena?
              // Probably a websocket message should be sent to all clients.
            }
          }
        });
      });

      // Remove all marked bullets.
      for (const bulletId of bulletIdsToRemove) {
        this.arena.removeBullet(bulletId);
      }
  }
}