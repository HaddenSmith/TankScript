// These helpers become ordinary, editable functions in the tank's code string.
// Only documented state and action functions are used. No persistent globals.
export const geometryCode = `
const me = { x: tankPosition.x, y: tankPosition.y, rotation: tankRotation };
const opponents = allTanks.filter(tank => tank.id !== tankId && tank.health > 0);
if (!opponents.length) return;
const walls = typeof allWalls === 'undefined' ? [] : allWalls.filter(wall => wall.health > 0);
const pickups = typeof allPowerups === 'undefined' ? [] : allPowerups;
const shotSpeed = typeof tankBulletSpeed === 'number' ? tankBulletSpeed : 0.5;
const maximumHealth = typeof tankMaxHealth === 'number' ? tankMaxHealth : 3;
const lightningRemaining = typeof tankLightningTicksRemaining === 'number' ? tankLightningTicksRemaining : 0;
const wallCells = new Array(arenaWidth * arenaHeight).fill(null);
for (const wall of walls) wallCells[wall.y * arenaWidth + wall.x] = wall;
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
  return inside(p) && !wallAt(p) && !allTanks.some(tank => tank.id !== tankId && tank.x === p.x && tank.y === p.y);
}
function wallAt(p) { return inside(p) ? wallCells[p.y * arenaWidth + p.x] : null; }
function wallInPath(from, to) {
  let closest = null;
  let closestDistance = Infinity;
  // Include half-cell edges: a bullet stops when it touches a wall's square.
  const minX = Math.max(0, Math.ceil(Math.min(from.x, to.x) - 0.5));
  const maxX = Math.min(arenaWidth - 1, Math.floor(Math.max(from.x, to.x) + 0.5));
  const minY = Math.max(0, Math.ceil(Math.min(from.y, to.y) - 0.5));
  const maxY = Math.min(arenaHeight - 1, Math.floor(Math.max(from.y, to.y) + 0.5));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const wall = wallCells[y * arenaWidth + x];
      if (!wall) continue;
      const d = Math.max(0, Math.abs(x - from.x) - 0.5) + Math.max(0, Math.abs(y - from.y) - 0.5);
      if (d < closestDistance) { closest = wall; closestDistance = d; }
    }
  }
  return closest;
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
  const aim = aimAt(from, to);
  return aim !== null && !wallInPath(from, to) && !allTanks.some(tank => tank.health > 0 &&
    tank.id !== tankId && tank.id !== from.id && tank.id !== to.id && aimAt(from, tank) === aim &&
    distance(from, tank) < distance(from, to));
}
function bulletAt(bullet, tick) {
  const direction = vector(bullet.rotation);
  const speed = bullet.speed ?? 0.5;
  return { x: bullet.x + direction.x * speed * tick, y: bullet.y + direction.y * speed * tick };
}
// Build three small threat grids once, rather than rescan every bullet for every action.
// Half-cell points cover normal endpoints and the swept paths of upgraded bullets.
const hazardWidth = arenaWidth * 2 + 1;
const hazards = Array.from({ length: 4 }, () => new Array(hazardWidth * (arenaHeight * 2 + 1)).fill(0));
const forcedHits = new Array(arenaWidth * arenaHeight).fill(0);
function hazardIndex(p) { return (p.y * 2 + 1) * hazardWidth + p.x * 2 + 1; }
function markHazard(p, tick) {
  if (p.x >= -0.5 && p.x <= arenaWidth - 0.5 && p.y >= -0.5 && p.y <= arenaHeight - 0.5) {
    hazards[tick][hazardIndex(p)]++;
  }
}
for (const bullet of allBullets) {
  const direction = vector(bullet.rotation);
  const speed = bullet.speed ?? 0.5;
  let start = { x: bullet.x, y: bullet.y };
  for (let tick = 1; tick <= 3; tick++) {
    let end = { x: start.x + direction.x * speed, y: start.y + direction.y * speed };
    let originalOccupant = null;
    if (tick === 1) {
      let nearest = Infinity;
      for (const tank of allTanks) {
        if (tank.health <= 0) continue;
        const first = speed > 0.5 ? start : end;
        if (tank.x < Math.min(first.x, end.x) || tank.x > Math.max(first.x, end.x) ||
            tank.y < Math.min(first.y, end.y) || tank.y > Math.max(first.y, end.y)) continue;
        const d = distance(start, tank);
        if (d < nearest) { originalOccupant = tank; nearest = d; }
      }
      if (originalOccupant) end = { x: originalOccupant.x, y: originalOccupant.y };
    }
    if (wallInPath(start, end)) break;
    if (originalOccupant) {
      // Bullet-first resolution reserves this hit for the original occupant, even if it moves.
      forcedHits[originalOccupant.y * arenaWidth + originalOccupant.x]++;
      break;
    }
    if (speed > 0.5) {
      markHazard(start, tick);
      markHazard({ x: start.x + direction.x * 0.5, y: start.y + direction.y * 0.5 }, tick);
    }
    markHazard(end, tick);
    if (!inside(end)) break;
    start = end;
  }
}
function bulletPathDanger(from, to, tick) {
  let risk = tick === 1 ? forcedHits[from.y * arenaWidth + from.x] ?? 0 : 0;
  const grid = hazards[tick];
  risk += grid[hazardIndex(from)] ?? 0;
  if (from.x !== to.x || from.y !== to.y) {
    risk += grid[hazardIndex({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })] ?? 0;
    risk += grid[hazardIndex(to)] ?? 0;
  }
  return risk;
}
function bulletDanger(position, tick) { return bulletPathDanger(position, position, tick); }
function shotScreened(target) {
  const forward = vector(me.rotation);
  const range = distance(me, target);
  return allBullets.some(bullet => {
    if ((bullet.rotation + 180) % 360 !== me.rotation) return false;
    // The new shot stays at its muzzle this tick and joins bullet collisions next tick.
    for (let tick = 2; tick <= Math.ceil(range / shotSpeed) + 1; tick++) {
      const other = bulletAt(bullet, tick);
      if (wallInPath(bullet, other)) break;
      const ownStart = 0.5 + (tick - 2) * shotSpeed;
      const ownEnd = ownStart + shotSpeed;
      const otherDistance = (other.x - me.x) * forward.x + (other.y - me.y) * forward.y;
      const sameLane = forward.x ? other.y === me.y : other.x === me.x;
      if (!sameLane) continue;
      if (otherDistance === ownEnd && ownEnd < range) return true;
      if (shotSpeed <= 0.5 && (bullet.speed ?? 0.5) <= 0.5) continue;
      const previous = bulletAt(bullet, tick - 1);
      const previousDistance = (previous.x - me.x) * forward.x + (previous.y - me.y) * forward.y;
      const time = (previousDistance - ownStart) / (shotSpeed + (bullet.speed ?? 0.5));
      if (time > 0 && time <= 1 && ownStart + shotSpeed * time < range) return true;
    }
    return false;
  });
}
function canSuppress(enemy) {
  return moves.some(move => {
    const next = { x: enemy.x + move.x, y: enemy.y + move.y };
    return free(next) && distance(next, me) < distance(enemy, me) &&
      aimAt(me, next) === me.rotation && distance(me, next) <= 3 && clearShot(me, next) &&
      bulletPathDanger(enemy, next, 1) === 0 && bulletDanger(next, 2) === 0 && bulletDanger(next, 3) === 0;
  });
}
function muzzleDanger(position) {
  // Cover blocks enemy guns; Lightning increases how far the following shot can reach.
  return opponents.reduce((risk, enemy) => {
    const aim = aimAt(enemy, position);
    if (aim === null || aim !== enemy.rotation || !clearShot(enemy, position)) return risk;
    const d = distance(enemy, position);
    const flightTicks = Math.max(1, Math.ceil((d - 0.5) / (enemy.bulletSpeed ?? 0.5)));
    return risk + (flightTicks === 1 ? 1 : flightTicks === 2 ? 0.6 : flightTicks === 3 ? 0.3 : 0.05 / d);
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
    (aim === null ? 1 : turns(position.rotation, aim)) + enemy.health * 0.15 +
    (aim !== null && wallInPath(position, enemy) ? 3 : 0);
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

function routeDistances(start) {
  const distances = new Array(arenaWidth * arenaHeight).fill(Infinity);
  const queue = [start];
  distances[start.y * arenaWidth + start.x] = 0;
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const nextDistance = distances[current.y * arenaWidth + current.x] + 1;
    for (const move of moves) {
      const next = { x: current.x + move.x, y: current.y + move.y };
      if (!free(next)) continue;
      const index = next.y * arenaWidth + next.x;
      if (distances[index] <= nextDistance) continue;
      distances[index] = nextDistance;
      queue.push(next);
    }
  }
  return distances;
}
function nearestPickup(type, distances) {
  let nearest = null;
  for (const pickup of pickups) {
    if (pickup.type !== type) continue;
    const steps = distances[pickup.y * arenaWidth + pickup.x];
    if (!Number.isFinite(steps)) continue;
    if (!nearest || steps < nearest.steps) nearest = { ...pickup, steps };
  }
  return nearest;
}
function combatRoute(target, aggressive, distances) {
  let goal = me;
  let breach = null;
  let best = Infinity;
  for (let y = 0; y < arenaHeight; y++) {
    for (let x = 0; x < arenaWidth; x++) {
      const steps = distances[y * arenaWidth + x];
      if (!Number.isFinite(steps)) continue;
      const position = { x, y, rotation: me.rotation };
      const aim = aimAt(position, target);
      if (aim === null) continue;
      const wall = wallInPath(position, target);
      if (!wall && !clearShot(position, target)) continue;
      // Compare a walking route with the actual health cost of breaking cover.
      const cost = steps + turns(me.rotation, aim) * 0.8 +
        Math.abs(distance(position, target) - (aggressive ? 1 : 2)) * 0.6 + (wall ? wall.health + 2 : 0);
      if (cost < best) { best = cost; goal = position; breach = wall; }
    }
  }
  if (!Number.isFinite(best)) {
    // A sealed room may have no firing lane at all. Open a reachable edge toward the enemy.
    for (let y = 0; y < arenaHeight; y++) {
      for (let x = 0; x < arenaWidth; x++) {
        const steps = distances[y * arenaWidth + x];
        if (!Number.isFinite(steps)) continue;
        const position = { x, y };
        for (const move of moves) {
          const wall = wallAt({ x: x + move.x, y: y + move.y });
          if (!wall) continue;
          const cost = steps + wall.health + distance(wall, target) + turns(me.rotation, aimAt(position, wall));
          if (cost < best) { best = cost; goal = position; breach = wall; }
        }
      }
    }
  }
  return { goal, breach, aim: aimAt(goal, breach || target), distances: routeDistances(goal) };
}
function routeValue(position, route) {
  const steps = route.distances[position.y * arenaWidth + position.x];
  if (!Number.isFinite(steps)) return -arenaWidth * arenaHeight;
  let value = -steps;
  if (steps === 0 && typeof route.aim === 'number') value -= turns(position.rotation, route.aim);
  return value;
}
`;
