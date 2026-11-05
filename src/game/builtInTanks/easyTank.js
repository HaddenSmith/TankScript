export default {
  id: 'easy',
  name: 'Firefly (Easy)',
  color: '#317d84',
  difficulty: 'easy',
  description: 'A curious scout with a slow scanning turret and no bullet avoidance.',
  code: `
const opponents = allTanks.filter(tank => tank.id !== tankId && tank.health > 0);
const target = opponents[0];
if (!target) return;

const dx = target.x - tankPosition.x;
const dy = target.y - tankPosition.y;
if (dx === 0 || dy === 0) {
  const aim = dy === 0 ? (dx > 0 ? 0 : 180) : (dy < 0 ? 90 : 270);
  if (tankRotation === aim && Math.random() < 0.65) shoot();
  else rotateLeft();
} else {
  // Work on one axis at a time. The turret does not need to face movement.
  if (Math.abs(dx) < Math.abs(dy)) {
    if (dx > 0) moveRight();
    else moveLeft();
  } else if (dy > 0) moveDown();
  else moveUp();
}
`,
};
