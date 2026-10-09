import { Arena } from './arena';
import { Tank } from './tank';
import { Bullet } from './bullet';
import { createTankScriptApi } from '../tank-script/tankScriptApi';

export class BattleEngine {
  constructor(width, height) {
    this.arena = new Arena(width, height);
    this.nextBulletId = 1;
    this.nextTankId = 1;
  }

  tickEngine() {
    const allCommands = this.collectCommands();

    this.moveBullets();
    
  }

  getNextBulletId() {
    const id = this.nextBulletId;
    this.nextBulletId += 1;
    return id;
  }

  getNextTankId() {
    const id = this.nextTankId;
    this.nextTankId += 1;
    return id;
  }

  collectCommands() {
  const allCommands = {};
    this.arena.tanks.forEach((tank) => {
      try {
        if (!tank.isAlive()) return;

        const api = createTankScriptApi();
        tank.code(api);

        switch (api.getSubmittedCommand()?.action) {
          case 'moveUp': 
            if (canTankMove(tank, 'moveUp')) allCommands[tank.id] = 'moveUp';
            break;
          case 'moveDown': 
            if (canTankMove(tank, 'moveDown')) allCommands[tank.id] = 'moveDown';
            break;
          case 'moveRight': 
            if (canTankMove(tank, 'moveRight')) allCommands[tank.id] = 'moveRight';
            break;
          case 'moveLeft': 
            if (canTankMove(tank, 'moveLeft')) allCommands[tank.id] = 'moveLeft';
            break;
          case 'rotateRight': 
            allCommands[tank.id] = 'rotateRight';
            break;
          case 'rotateLeft': 
            allCommands[tank.id] = 'rotateLeft';
            break;
          case 'shoot': allCommands[tank.id] = 'shoot';
          break;
        }
      } catch (error) {
        console.error(`${tank.name} failed:`, error);
      }
    });

    return allCommands;
  }

  moveBullets() {
    this.arena.bullets.forEach((bullet) => {
      bullet.move();

      if (this.arena.isOutOfBounds(bullet)) {
        this.arena.removeBullet(bullet.id);
        return;
      }

      this.arena.tanks.forEach((tank) => {
        if (bullet.isCollidingWithTank(tank)) {
          this.arena.removeBullet(bullet.id);
          tank.takeDamage();

          if (!tank.isAlive()) {
            console.log(`${tank.name} has been destroyed!`);
            // Do other things like dont display the tank, etc..? Remove it from the arena?
            // Probably a websocket message should be sent to all clients.
          }
        }
      });
    });
  }

  canTankMove(tank, command) {
    const dummyTank = new Tank(tank.id, tank.name, tank.x, tank.y, tank.code);

    switch (command) {
      case 'moveUp': 
        dummyTank.moveUp();
        break;
      case 'moveDown': 
        dummyTank.moveDown();
        break;
      case 'moveRight': 
        dummyTank.moveRight();
        break;
      case 'moveLeft': 
        dummyTank.moveLeft();
        break;
    }

    if (this.arena.isOutOfBounds(dummyTank)) return false;
    if (this.arena.isPositionOccupiedByTank(dummyTank.x, dummyTank.y)) return false;
    return true;
  }
}