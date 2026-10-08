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

export function shootTank(tank) {
  // Placeholder for shooting logic; actual implementation will depend on game mechanics.
  console.log(`${tank.name} shoots!`);
}
