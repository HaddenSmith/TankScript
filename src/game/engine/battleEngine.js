import { Arena } from './arena';
import { Tank } from './tank';
import { Bullet } from './bullet';
import { createTankScriptApi } from '../tank-script/tankScriptApi';

export function createBattle(width, height) {
  const arena = new Arena(width, height);

  let nextBulletId = 1;
  let nextTankId = 1;

  function getNextBulletId() {
    const id = nextBulletId;
    nextBulletId += 1;
    return id;
  }

  function getNextTankId() {
    const id = nextTankId;
    nextTankId += 1;
    return id;
  }

  return arena;
}

export function tickEngine(arena) {
  const allCommands = {};
  arena.tanks.forEach((tank) => {
    try {
      if (!tank.isAlive()) return;

      const api = createTankScriptApi();
      tank.code(api);

      switch (api.getSubmittedCommand()?.action) {
        case 'moveUp': 
          if (canTankMove(tank, arena, 'moveUp')) allCommands[tank.id] = 'moveUp';
          break;
        case 'moveDown': 
          if (canTankMove(tank, arena, 'moveDown')) allCommands[tank.id] = 'moveDown';
          break;
        case 'moveRight': 
          if (canTankMove(tank, arena, 'moveRight')) allCommands[tank.id] = 'moveRight';
          break;
        case 'moveLeft': 
          if (canTankMove(tank, arena, 'moveLeft')) allCommands[tank.id] = 'moveLeft';
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

  console.log('Commands for this tick:', allCommands);

  // Move bullets
  arena.bullets.forEach((bullet) => {
    bullet.move();

    if (arena.isOutOfBounds(bullet)) {
      arena.removeBullet(bullet.id);
      return;
    }

    arena.tanks.forEach((tank) => {
      if (bullet.isCollidingWithTank(tank)) {
        arena.removeBullet(bullet.id);
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

function canTankMove(tank, arena, command) {
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
  if (arena.isOutOfBounds(dummyTank)) return false;
  if (arena.isPositionOccupiedByTank(dummyTank.x, dummyTank.y)) return false;
  return true;
}