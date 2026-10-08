export function createBullet(id, ownerId, x, y, rotation) {
  return {
    id,
    ownerId,
    x,
    y,
    rotation,
  };
}

export function moveBullet(bullet) {
  if (bullet.rotation === 0) {
    bullet.x += 1;
  } else if (bullet.rotation === 90) {
    bullet.y -= 1;
  } else if (bullet.rotation === 180) {
    bullet.x -= 1;
  } else if (bullet.rotation === 270) {
    bullet.y += 1;  
  }
}

export function isBulletCollidingWithTank(bullet, tank) {
  return bullet.x === tank.x && bullet.y === tank.y;
}