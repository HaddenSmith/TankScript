export default {
  id: 'medium',
  name: 'Bloodhound (Medium)',
  color: '#31834a',
  difficulty: 'medium',
  description: 'A direct hunter with basic aiming, local wall avoidance, and short-range dodges.',
  code: `
const opponents = allTanks.filter(tank => tank.id !== tankId && tank.health > 0);
const distance = tank => Math.abs(tank.x - tankPosition.x) + Math.abs(tank.y - tankPosition.y);
const target = opponents.reduce((best, tank) => !best || distance(tank) < distance(best) ? tank : best, null);
if (!target) return;
const walls = typeof allWalls === 'undefined' ? [] : allWalls.filter(wall => wall.health > 0);
function blockedShot(from, to) {
  return walls.some(wall => wall.x + 0.5 >= Math.min(from.x, to.x) && wall.x - 0.5 <= Math.max(from.x, to.x) &&
    wall.y + 0.5 >= Math.min(from.y, to.y) && wall.y - 0.5 <= Math.max(from.y, to.y));
}

const moves = [
  { x: 0, y: -1, act: moveUp }, { x: 0, y: 1, act: moveDown },
  { x: -1, y: 0, act: moveLeft }, { x: 1, y: 0, act: moveRight },
];
const legal = moves.filter(move => {
  const x = tankPosition.x + move.x;
  const y = tankPosition.y + move.y;
  const crossesBullet = allBullets.some(bullet => {
    const speed = bullet.speed ?? 0.5;
    const bx = bullet.x + (bullet.rotation === 0 ? speed : bullet.rotation === 180 ? -speed : 0);
    const by = bullet.y + (bullet.rotation === 270 ? speed : bullet.rotation === 90 ? -speed : 0);
    if (blockedShot(bullet, { x: bx, y: by })) return false;
    const start = speed > 0.5 ? bullet : { x: bx, y: by };
    return Math.max(Math.min(start.x, bx), Math.min(tankPosition.x, x)) <= Math.min(Math.max(start.x, bx), Math.max(tankPosition.x, x)) &&
      Math.max(Math.min(start.y, by), Math.min(tankPosition.y, y)) <= Math.min(Math.max(start.y, by), Math.max(tankPosition.y, y));
  });
  return x >= 0 && x < arenaWidth && y >= 0 && y < arenaHeight && !crossesBullet &&
    !allTanks.some(tank => tank.id !== tankId && tank.x === x && tank.y === y) &&
    !walls.some(wall => wall.x === x && wall.y === y);
});
function hitsSoon(x, y) {
  return allBullets.some(bullet => {
    const speed = bullet.speed ?? 0.5;
    const vx = bullet.rotation === 0 ? speed : bullet.rotation === 180 ? -speed : 0;
    const vy = bullet.rotation === 270 ? speed : bullet.rotation === 90 ? -speed : 0;
    if (blockedShot(bullet, { x, y })) return false;
    for (let tick = 1; tick <= 2; tick++) {
      const start = speed > 0.5 ? tick - 1 : tick;
      if (x >= Math.min(bullet.x + vx * start, bullet.x + vx * tick) && x <= Math.max(bullet.x + vx * start, bullet.x + vx * tick) &&
          y >= Math.min(bullet.y + vy * start, bullet.y + vy * tick) && y <= Math.max(bullet.y + vy * start, bullet.y + vy * tick)) return true;
    }
    return false;
  });
}
if (hitsSoon(tankPosition.x, tankPosition.y)) {
  const dodge = legal.find(move => !hitsSoon(tankPosition.x + move.x, tankPosition.y + move.y));
  if (dodge) { dodge.act(); return; }
}
if (!legal.length) {
  const wall = walls.find(wall => Math.abs(wall.x - tankPosition.x) + Math.abs(wall.y - tankPosition.y) === 1);
  if (wall) {
    const aim = wall.x !== tankPosition.x ? (wall.x > tankPosition.x ? 0 : 180) : (wall.y < tankPosition.y ? 90 : 270);
    if (tankRotation === aim) shoot();
    else if ((aim - tankRotation + 360) % 360 === 270) rotateRight();
    else rotateLeft();
  } else rotateLeft();
  return;
}

const dx = target.x - tankPosition.x;
const dy = target.y - tankPosition.y;
if (dx === 0 || dy === 0) {
  if (blockedShot(tankPosition, target)) {
    const flank = legal.find(move => dy === 0 ? move.y !== 0 : move.x !== 0);
    if (flank) { flank.act(); return; }
  }
  // Distant streams are easy to evade; close to a useful engagement range.
  const approach = legal.find(move => Math.abs(dx - move.x) + Math.abs(dy - move.y) < Math.abs(dx) + Math.abs(dy));
  if (Math.abs(dx) + Math.abs(dy) > 3 && approach) { approach.act(); return; }
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
