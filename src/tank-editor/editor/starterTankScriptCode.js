// TankScript runs once every battle tick.
// Your tank can choose one action each tick.

const enemy = allTanks.find(
  (tank) => tank.id !== tankId && tank.health > 0
);

if (enemy) {
  shoot();
}
