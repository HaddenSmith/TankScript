import * as arenaFunctions from './arena';
import * as tankFunctions from './tank';
import * as bulletFunctions from './bullet';

export function createBattle(width, height) {
  const arena = arenaFunctions.createArena(width, height);

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
  // Move tanks
  arena.tanks.forEach(tank => {
    //tank. //Somehow loop through each tank and see what their action is and then call the appropriate function to move them
  });

  // Move bullets
  arena.bullets.forEach((bullet) => {
    bulletFunctions.moveBullet(bullet);
  });
}