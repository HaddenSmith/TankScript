export default {
  id: 'easy',
  name: 'Firefly (Easy)',
  color: '#317d84',
  difficulty: 'easy',
  description: 'A predictable scout: simple pursuit, a scanning turret, and no bullet avoidance.',
  code: `
const opponents = allTanks.filter(tank => tank.id !== tankId && tank.health > 0);
const target = opponents[0];
if (!target) return;
const walls = typeof allWalls === 'undefined' ? [] : allWalls.filter(wall => wall.health > 0);
const moves = [
  { x: 0, y: -1, act: moveUp }, { x: 1, y: 0, act: moveRight },
  { x: 0, y: 1, act: moveDown }, { x: -1, y: 0, act: moveLeft },
];
const legal = moves.filter(move => {
  const x = tankPosition.x + move.x;
  const y = tankPosition.y + move.y;
  return x >= 0 && x < arenaWidth && y >= 0 && y < arenaHeight &&
    !walls.some(wall => wall.x === x && wall.y === y) &&
    !allTanks.some(tank => tank.id !== tankId && tank.x === x && tank.y === y);
});

const dx = target.x - tankPosition.x;
const dy = target.y - tankPosition.y;
if (dx === 0 || dy === 0) {
  const aim = dy === 0 ? (dx > 0 ? 0 : 180) : (dy < 0 ? 90 : 270);
  // A simple single-shot turret scans while its previous bullet is in flight.
  if (tankRotation === aim && !allBullets.some(bullet => bullet.ownerId === tankId)) shoot();
  else rotateLeft();
} else {
  // Work on one axis at a time. The turret does not need to face movement.
  const preferred = Math.abs(dx) < Math.abs(dy)
    ? legal.find(move => move.x === Math.sign(dx))
    : legal.find(move => move.y === Math.sign(dy));
  const move = preferred || legal[0];
  if (move) move.act();
  else shoot();
}
`,
};
