// This code runs once during each game tick.
// All tanks submit one command, then the game resolves them simultaneously.
// Check tankPosition, tankRotation, tankHealth, and tankPositions before acting.
// Once an action command is found, your code stops for this tick.

const enemy = tankPositions.find((tank) => tank.isEnemy);

if (enemy && tankHealth > 0) {
  shoot();
  // After shoot() runs, execution stops, so a later move() will not run this tick.
} else {
  move();
}

return;