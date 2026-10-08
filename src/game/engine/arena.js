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

export function isPositionOccupiedByTank(arena, x, y) {
  return arena.tanks.some(tank => tank.x === x && tank.y === y);
}

export function getTankAtPosition(arena, x, y) {
  return arena.tanks.find(tank => tank.x === x && tank.y === y);
}

export function isOutOfBounds(arena, object) { // For both tanks and bullets
  return (
    object.x < 0 ||
    object.x >= arena.width ||
    object.y < 0 ||
    object.y >= arena.height
  );
}