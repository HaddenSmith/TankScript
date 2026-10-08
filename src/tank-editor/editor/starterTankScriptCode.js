// The game evaluates this code once during each tick using the current arena state.
// The first action call is recorded as this tank's command; later action calls are ignored.
// Every tank submits one command, then the game resolves all commands simultaneously.

const enemy = tankPositions.find((tank) => tank.isEnemy);

if (enemy && tankHealth > 0) {
  shoot();
} else {
  moveRight();
}
