export function createTank(id, name, x, y) {
  return {
    id,
    name,
    x,
    y,
    rotation: 0,
    health: 3,
  };
}

export function moveTank(tank) {
  if (tank.rotation === 0) {
    tank.x += 1;
  } else if (tank.rotation === 90) {
    tank.y -= 1;
  } else if (tank.rotation === 180) {
    tank.x -= 1;
  } else if (tank.rotation === 270) {
    tank.y += 1;
  }
}

export function moveTankBackward(tank) {
  if (tank.rotation === 0) {
    tank.x -= 1;
  } else if (tank.rotation === 90) {
    tank.y += 1;
  } else if (tank.rotation === 180) {
    tank.x += 1;
  } else if (tank.rotation === 270) {
    tank.y -= 1;
  }
}

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
