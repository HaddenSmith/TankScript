export function createArena(width, height) {
  return {
    width,
    height,
    tanks: [],
    bullets: [],
  };
}

export function addTankToArena(arena, tank) {
  arena.tanks.push(tank);
}

export function addBulletToArena(arena, bullet) {
  arena.bullets.push(bullet);
}

export function removeTankFromArena(arena, tankId) {
  arena.tanks = arena.tanks.filter(tank => tank.id !== tankId);
}

export function removeBulletFromArena(arena, bulletId) {
  arena.bullets = arena.bullets.filter(bullet => bullet.id !== bulletId);
}

export function getTankById(arena, tankId) {
  return arena.tanks.find(tank => tank.id === tankId);
}

export function getBulletById(arena, bulletId) {
  return arena.bullets.find(bullet => bullet.id === bulletId);
}

export function isTankInBounds(arena, tank) {
  return tank.x >= 0 && tank.x < arena.width && tank.y >= 0 && tank.y < arena.height;
}

export function isBulletInBounds(arena, bullet) {
  return bullet.x >= 0 && bullet.x < arena.width && bullet.y >= 0 && bullet.y < arena.height;
}

export function isPositionOccupiedByTank(arena, x, y) {
  return arena.tanks.some(tank => tank.x === x && tank.y === y);
}

export function getTankAtPosition(arena, x, y) {
  return arena.tanks.find(tank => tank.x === x && tank.y === y);
}