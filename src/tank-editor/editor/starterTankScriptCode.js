// The game evaluates this code once during each tick using the current arena state.
// The first action call is recorded as this tank's command; later action calls are ignored.
// Every tank submits one command, then the game resolves all commands simultaneously.

const otherTank = allTanks.find(
  (tank) => tank.x !== tankPosition.x || tank.y !== tankPosition.y
);

if (otherTank && tankHealth > 0) {
  shoot();
} else {
  moveRight();
}
