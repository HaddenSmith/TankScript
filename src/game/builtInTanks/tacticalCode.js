// These helpers become ordinary, editable functions in the tank's code string.
// Only documented state and action functions are used. No persistent globals.
export const geometryCode = `
const me = { x: tankPosition.x, y: tankPosition.y, rotation: tankRotation };
const opponents = allTanks.filter(tank => tank.id !== tankId && tank.health > 0);
if (!opponents.length) return;
const moves = [
  { name: 'moveUp', x: 0, y: -1, act: moveUp },
  { name: 'moveRight', x: 1, y: 0, act: moveRight },
  { name: 'moveDown', x: 0, y: 1, act: moveDown },
  { name: 'moveLeft', x: -1, y: 0, act: moveLeft },
];
function vector(rotation) {
  return { x: rotation === 0 ? 1 : rotation === 180 ? -1 : 0,
    y: rotation === 270 ? 1 : rotation === 90 ? -1 : 0 };
}
function distance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function inside(p) { return p.x >= 0 && p.x < arenaWidth && p.y >= 0 && p.y < arenaHeight; }
function free(p) {
  // Wrecks also block movement in this engine.
  return inside(p) && !allTanks.some(tank => tank.id !== tankId && tank.x === p.x && tank.y === p.y);
}
function aimAt(from, to) {
  if (from.y === to.y && from.x !== to.x) return to.x > from.x ? 0 : 180;
  if (from.x === to.x && from.y !== to.y) return to.y < from.y ? 90 : 270;
  return null;
}
function turns(from, to) {
  const difference = (to - from + 360) % 360;
  return Math.min(difference, 360 - difference) / 90;
}
function turnTo(aim) {
  if ((aim - tankRotation + 360) % 360 === 270) rotateRight();
  else rotateLeft();
}
function approachTurns(position, enemy) {
  const aim = aimAt(position, enemy);
  if (aim !== null) return turns(position.rotation, aim);
  const horizontal = enemy.x > position.x ? 0 : 180;
  const vertical = enemy.y < position.y ? 90 : 270;
  return Math.min(turns(position.rotation, horizontal), turns(position.rotation, vertical));
}
function clearShot(from, to) {
  return !opponents.some(tank => tank.id !== to.id && aimAt(from, tank) === aimAt(from, to) &&
    distance(from, tank) < distance(from, to));
}
function bulletAt(bullet, tick) {
  const direction = vector(bullet.rotation);
  return { x: bullet.x + direction.x * 0.5 * tick, y: bullet.y + direction.y * 0.5 * tick };
}
function bulletDanger(position, tick) {
  // Include our own bullets: the engine has no owner immunity.
  return allBullets.reduce((hits, bullet) => {
    const p = bulletAt(bullet, tick);
    return hits + Number(inside(p) && p.x === position.x && p.y === position.y);
  }, 0);
}
function bulletPathDanger(from, to, tick) {
  return allBullets.reduce((hits, bullet) => {
    const p = bulletAt(bullet, tick);
    const crosses = from.x === to.x
      ? p.x === from.x && p.y >= Math.min(from.y, to.y) && p.y <= Math.max(from.y, to.y)
      : p.y === from.y && p.x >= Math.min(from.x, to.x) && p.x <= Math.max(from.x, to.x);
    return hits + Number(inside(p) && crosses);
  }, 0);
}
function shotScreened(target) {
  const forward = vector(me.rotation);
  const range = distance(me, target);
  return allBullets.some(bullet => {
    if ((bullet.rotation + 180) % 360 !== me.rotation) return false;
    // Both existing bullets move next tick; the new shot starts at the muzzle.
    for (let tick = 1; tick <= range * 2; tick++) {
      const other = bulletAt(bullet, tick);
      const x = me.x + forward.x * (tick + 1) * 0.5;
      const y = me.y + forward.y * (tick + 1) * 0.5;
      if (other.x === x && other.y === y) return true;
    }
    return false;
  });
}
function canSuppress(enemy) {
  return moves.some(move => {
    const next = { x: enemy.x + move.x, y: enemy.y + move.y };
    return inside(next) && aimAt(me, next) === me.rotation && distance(me, next) <= 3;
  });
}
function muzzleDanger(position) {
  // A new shot travels half a cell on creation, then half a cell per tick.
  return opponents.reduce((risk, enemy) => {
    const aim = aimAt(enemy, position);
    if (aim === null || aim !== enemy.rotation) return risk;
    const d = distance(enemy, position);
    return risk + (d === 1 ? 1 : d === 2 ? 0.3 : 0.05 / d);
  }, 0);
}
function exits(position) {
  return moves.filter(move => free({ x: position.x + move.x, y: position.y + move.y })).length;
}
function targetCost(position, enemy) {
  const dx = Math.abs(position.x - enemy.x);
  const dy = Math.abs(position.y - enemy.y);
  const aim = aimAt(position, enemy);
  return 2 * Math.min(dx, dy) + 0.22 * (dx + dy) +
    (aim === null ? 1 : turns(position.rotation, aim)) + enemy.health * 0.15;
}
function bestTarget(position) {
  return opponents.reduce((best, enemy) => targetCost(position, enemy) < targetCost(position, best) ? enemy : best);
}
function positionValue(position, target, aggressive) {
  const d = distance(position, target);
  const aim = aimAt(position, target);
  const alignment = Math.min(Math.abs(position.x - target.x), Math.abs(position.y - target.y));
  const close = d <= (aggressive ? 1 : 2);
  return -alignment * (close ? 2.5 : 0.15) - d * (aggressive ? 2.2 : 1.5) +
    (aim === null || !close ? 0 : 3 - turns(position.rotation, aim) * 1.8) + exits(position) * 0.18;
}
`;
