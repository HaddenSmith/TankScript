export default {
  id: 'medium',
  name: 'Bloodhound (Medium)',
  color: 'green',
  difficulty: 'medium',
  description: 'Hunts the nearest opponent and sidesteps immediate bullets.',
  code: `
const opponents = allTanks.filter(tank => tank.id !== tankId && tank.health > 0);
const distance = tank => Math.abs(tank.x - tankPosition.x) + Math.abs(tank.y - tankPosition.y);
const target = opponents.reduce((best, tank) => !best || distance(tank) < distance(best) ? tank : best, null);
if (!target) return;

const moves = [
  { x: 0, y: -1, act: moveUp }, { x: 0, y: 1, act: moveDown },
  { x: -1, y: 0, act: moveLeft }, { x: 1, y: 0, act: moveRight },
];
const legal = moves.filter(move => {
  const x = tankPosition.x + move.x;
  const y = tankPosition.y + move.y;
  return x >= 0 && x < arenaWidth && y >= 0 && y < arenaHeight &&
    !allTanks.some(tank => tank.id !== tankId && tank.x === x && tank.y === y);
});
function hitsSoon(x, y) {
  return allBullets.some(bullet => {
    const vx = bullet.rotation === 0 ? 0.5 : bullet.rotation === 180 ? -0.5 : 0;
    const vy = bullet.rotation === 270 ? 0.5 : bullet.rotation === 90 ? -0.5 : 0;
    return (bullet.x + vx === x && bullet.y + vy === y) ||
      (bullet.x + vx * 2 === x && bullet.y + vy * 2 === y);
  });
}
if (hitsSoon(tankPosition.x, tankPosition.y)) {
  const dodge = legal.find(move => !hitsSoon(tankPosition.x + move.x, tankPosition.y + move.y));
  if (dodge) { dodge.act(); return; }
}

const dx = target.x - tankPosition.x;
const dy = target.y - tankPosition.y;
if (dx === 0 || dy === 0) {
  const contested = allBullets.some(bullet => bullet.ownerId !== tankId &&
    (dy === 0 ? bullet.y === tankPosition.y : bullet.x === tankPosition.x));
  const flank = legal.find(move => dy === 0 ? move.y !== 0 : move.x !== 0);
  if (contested && flank && Math.random() < 0.12) { flank.act(); return; }
  const aim = dy === 0 ? (dx > 0 ? 0 : 180) : (dy < 0 ? 90 : 270);
  const turn = (aim - tankRotation + 360) % 360;
  if (turn === 0) shoot();
  else if (turn === 270) rotateRight();
  else rotateLeft();
} else {
  // A little leading fire catches opponents stepping into our firing lane.
  const futureX = target.x + (tankRotation === 90 || tankRotation === 270 ? Math.sign(-dx) : 0);
  const futureY = target.y + (tankRotation === 0 || tankRotation === 180 ? Math.sign(-dy) : 0);
  const facingFuture = (tankRotation === 0 && futureY === tankPosition.y && futureX > tankPosition.x) ||
    (tankRotation === 180 && futureY === tankPosition.y && futureX < tankPosition.x) ||
    (tankRotation === 90 && futureX === tankPosition.x && futureY < tankPosition.y) ||
    (tankRotation === 270 && futureX === tankPosition.x && futureY > tankPosition.y);
  if (Math.abs(dx) + Math.abs(dy) <= 3 && facingFuture && Math.random() < 0.25) { shoot(); return; }
  const preferred = Math.abs(dx) < Math.abs(dy)
    ? legal.find(move => move.x === Math.sign(dx))
    : legal.find(move => move.y === Math.sign(dy));
  const move = Math.random() < 0.08 ? legal[Math.floor(Math.random() * legal.length)] : preferred || legal[0];
  if (move) move.act();
  else rotateLeft();
}
`,
};
