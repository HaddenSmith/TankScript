export function createTank(id, name, x, y, code) {
  return {
    id,
    name,
    x,
    y,
    rotation: 0,
    health: 3,
    code,
  };
}

export function moveTankUp(tank) { tank.y--; }

export function moveTankDown(tank) { tank.y++; }

export function moveTankRight(tank) { tank.x++; }

export function moveTankLeft(tank) { tank.x--; }

export function rotateTankLeft(tank) {
  tank.rotation = (tank.rotation + 90) % 360;
}

export function rotateTankRight(tank) {
  tank.rotation = (tank.rotation + 270) % 360;
}

export function shoot(tank, bulletId) {
  let x = tank.x;
  let y = tank.y;

  if (tank.rotation === 0) {
    x += 0.5;
  } else if (tank.rotation === 90) {
    y -= 0.5;
  } else if (tank.rotation === 180) {
    x -= 0.5;
  } else if (tank.rotation === 270) {
    y += 0.5;
  }

  return createBullet(bulletId, tank.id, x, y, tank.rotation);
}
