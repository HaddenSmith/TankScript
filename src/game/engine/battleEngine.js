import { Arena } from './arena';
import { Tank } from './tank';
import { createTankScriptApi } from '../tank-script/tankScriptApi';

export class BattleEngine {
  constructor(width, height) {
    this.arena = new Arena(width, height);
    this.nextBulletId = 1;
    this.nextTankId = 1;
  }

  tickEngine() {
    const allRequestedCommands = this.#collectCommands();

    const allResolvedCommands = this.#resolveMovementCommands(allRequestedCommands);

    this.#moveBullets();

    this.#executeCommands(allResolvedCommands);
  }

  #collectCommands() {
    const allCommands = {};
    this.arena.tanks.forEach((tank) => {
      try {
        if (!tank.isAlive()) return;

        const api = createTankScriptApi();
        const tankState = this.#createTankState(tank);
        tank.code(api, tankState);

        allCommands[tank.id] = api.getSubmittedCommand()?.action;
      } catch (error) {
        console.error(`${tank.name} failed:`, error);
      }
    });

    return allCommands;
  }

  #createTankState(tank) {
    const tankState = {
      tankPosition: { x: tank.x, y: tank.y},
      tankRotation: tank.rotation,
      tankHealth: tank.health,
      tankId: tank.id,
      tankPositions: []
    }

    this.arena.tanks.forEach((tank) => {
      tankState.tankPositions.push(
        { id: tank.id, 
          name: tank.name, 
          x: tank.x, 
          y: tank.y, 
          rotation: tank.rotation, 
          health: tank.health }
      );
    });

    return tankState;
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
    const allMoveIntents = [];
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

      allMoveIntents.push(moveIntent);
    });

    // Compare movement intents against each other.
    for (const intent1 of allMoveIntents) {
      for (const intent2 of allMoveIntents) {
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
        if (tank.x === intent1.toX && tank.y === intent1.toY && tank.id != intent1.tankId) {
          const tankIsMoving = allMoveIntents.some(
            (intent) => intent.tankId === tank.id
          );

          // If the occupying tank is NOT moving away,
          // block this movement.
          if (!tankIsMoving) blockList.add(intent1.tankId);
        }
      });
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
    const deleteBulletList = new Set();

    this.arena.bullets.forEach((bullet) => {
      bullet.move();

      if (this.arena.isOutOfBounds(bullet)) {
        deleteBulletList.push(bullet.id);
        return;
      }

      this.arena.tanks.forEach((tank) => {
        if (bullet.isCollidingWithTank(tank)) {
          deleteBulletList.push(bullet.id);
          tank.takeDamage();

          if (!tank.isAlive()) {
            console.log(`${tank.name} has been destroyed!`);
            // Do other things like dont display the tank, etc..? Remove it from the arena?
            // Probably a websocket message should be sent to all clients.
          }
        }
      });
    });

    // If two bullets occupy the same position, they colide and get deleted
      this.arena.bullets.forEach((bullet1) => {
        this.arena.bullets.forEach((bullet2) => {
          if (bullet1.id != bullet2.id) return;
          if (bullet1.x === bullet2.x && bullet1.y === bullet2.y) {
            deleteBulletList.push(bullet1.id);
            deleteBulletList.push(bullet2.id)
          }
        });
      });

      // Delete all bullets on the set
      for (const bulletId of deleteBulletList) {
        this.arena.deleteBulletList(bulletId);
      }
  }
}