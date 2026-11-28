import { geometryCode } from './tacticalCode.js';

export default {
  id: 'overkill',
  name: 'Checkmate (Overkill)',
  color: '#b84579',
  difficulty: 'overkill',
  description: 'A predictive attacker that sets close-range traps, plans escapes, and weighs cover against pickups.',
  code: geometryCode + `
// Finish accessible wounded opponents instead of spreading damage across the whole arena.
let target = opponents[0];
let bestCost = Infinity;
for (const enemy of opponents) {
  let cost = targetCost(me, enemy) + enemy.health * 1.5;
  if (aimAt(me, enemy) === me.rotation && clearShot(me, enemy)) cost -= 2;
  if (cost < bestCost) { bestCost = cost; target = enemy; }
}
let route = null;
if (walls.length || pickups.length) {
  const paths = routeDistances(me);
  const heart = nearestPickup('heart', paths);
  const lightning = nearestPickup('lightning', paths);
  const finishingShot = target.health === 1 && distance(me, target) <= 1 &&
    aimAt(me, target) === me.rotation && clearShot(me, target);
  let pickup = null;
  if (!finishingShot && tankHealth < maximumHealth && heart && heart.steps <= (tankHealth <= 1 ? 10 : 4)) pickup = heart;
  else if (!finishingShot && lightning && lightning.steps <= 6 && lightningRemaining <= lightning.steps + 10) pickup = lightning;
  route = pickup ? { goal: pickup, pickup, breach: null, distances: routeDistances(pickup) } : combatRoute(target, true, paths);
}
const candidates = [
  { position: me, act: shoot, kind: 'shoot' },
  { position: { ...me, rotation: (me.rotation + 90) % 360 }, act: rotateLeft, kind: 'turn' },
  { position: { ...me, rotation: (me.rotation + 270) % 360 }, act: rotateRight, kind: 'turn' },
  ...moves.map(move => ({ position: { x: me.x + move.x, y: me.y + move.y, rotation: me.rotation },
    act: move.act, kind: 'move' })).filter(choice => free(choice.position)),
];

// A small opponent model: weigh pursuit, a ready turret, bullet safety and
// likely suppressing fire. It never inspects another tank's code or command.
function forecast(enemy) {
  const options = [
    { ...enemy, kind: 'shoot' },
    { ...enemy, rotation: (enemy.rotation + 90) % 360, kind: 'turn' },
    { ...enemy, rotation: (enemy.rotation + 270) % 360, kind: 'turn' },
    ...moves.map(move => ({ x: enemy.x + move.x, y: enemy.y + move.y,
      rotation: enemy.rotation, kind: 'move' })).filter(p => inside(p) && !wallAt(p) &&
      !allTanks.some(tank => tank.id !== enemy.id && tank.x === p.x && tank.y === p.y)),
  ];
  for (const p of options) {
    const d = distance(p, me);
    const alignment = Math.min(Math.abs(p.x - me.x), Math.abs(p.y - me.y));
    p.score = -d * 1.5 - alignment * 2 - approachTurns(p, me) -
      bulletPathDanger(enemy, p, 1) * 1000 - bulletDanger(p, 2) * 30;
    if (aimAt(me, p) === me.rotation && d === 1) p.score -= 4;
    if (p.kind === 'shoot') {
      if (aimAt(p, me) === p.rotation && clearShot(p, me)) p.score += 7 / d - 2;
      else if (d === 2 && alignment === 1 && approachTurns(p, me) === 0) p.score += 6;
      else p.score -= 8;
    }
    for (const pickup of pickups) {
      if (pickup.type === 'heart' && enemy.health < (enemy.maxHealth ?? 3)) {
        p.score += Math.max(0, 4 - distance(p, pickup)) * (enemy.health === 1 ? 2 : 1);
      } else if (pickup.type === 'lightning' && (enemy.lightningTicksRemaining ?? 0) < 5) {
        p.score += Math.max(0, 3 - distance(p, pickup));
      }
    }
  }
  const best = Math.max(...options.map(p => p.score));
  const sum = options.reduce((total, p) => total + Math.exp((p.score - best) / 1.5), 0);
  return options.map(p => ({ ...p, probability: Math.exp((p.score - best) / 1.5) / sum }));
}
const predictions = opponents.map(enemy => ({ enemy, options: forecast(enemy) }));

function gunRisk(position) {
  return opponents.reduce((risk, enemy) => {
    if (aimAt(enemy, position) !== enemy.rotation || !clearShot(enemy, position)) return risk;
    const d = distance(enemy, position);
    // Accept a favorable trade, but avoid gambling the last health point.
    const contact = tankHealth === 1 ? 70 : tankHealth > enemy.health ? 10 :
      tankHealth < enemy.health || tankHealth === 2 ? 32 : 16;
    const speed = enemy.bulletSpeed ?? 0.5;
    const flightTicks = Math.max(1, Math.ceil((d - 0.5) / speed));
    return risk + (flightTicks === 1 ? contact : flightTicks === 2 ? 4 : flightTicks === 3 ? 2 : 0.1);
  }, 0);
}

// Search reachable escape cells two decisions ahead. Unlike a stationary
// forecast, each edge checks the entire move against the engine's bullet phase.
const escapeScores = new Map();
function escapePositions(position) {
  return [position, ...moves.map(move => ({ x: position.x + move.x, y: position.y + move.y })).filter(free)];
}
function escapeCost(start) {
  const key = start.x + ',' + start.y;
  if (escapeScores.has(key)) return escapeScores.get(key);
  let best = Infinity;
  for (const next of escapePositions(start)) {
    const firstCost = bulletPathDanger(start, next, 2) * 250;
    for (const last of escapePositions(next)) {
      const cost = firstCost + bulletPathDanger(next, last, 3) * 500 / 3;
      best = Math.min(best, cost);
    }
  }
  escapeScores.set(key, best);
  return best;
}

function attackValue() {
  let reward = -10;
  for (const enemy of opponents) {
    const d = distance(me, enemy);
    if (aimAt(me, enemy) === me.rotation && clearShot(me, enemy) && !shotScreened(enemy)) {
      reward = Math.max(reward, (d === 1 ? 18 : d === 2 ? (shotSpeed > 0.5 ? 10 : 4) : -3) + (4 - exits(enemy)));
    }
  }
  const direction = vector(me.rotation);
  const impact = { x: me.x + direction.x, y: me.y + direction.y };
  // A new shot reaches this cell next tick, so an opponent stepping here now
  // cannot wait until the following decision to dodge it.
  for (const { enemy, options } of predictions) {
    if (!clearShot(me, impact)) continue;
    // Existing fire already denies this cell; advance or change angle instead of spamming it.
    if (bulletDanger(impact, 2) || bulletDanger(impact, 3)) continue;
    const probability = options.filter(p => p.x === impact.x && p.y === impact.y)
      .reduce((total, p) => total + p.probability, 0);
    reward = Math.max(reward, probability * (enemy.health === 1 ? 45 : 30) - 2);
  }
  return reward;
}

for (const choice of candidates) {
  const p = choice.position;
  choice.score = positionValue(p, target, true) - approachTurns(p, target) * (route && route.pickup ? 0 : 3) - gunRisk(p) -
    bulletPathDanger(me, p, 1) * 1000 - bulletDanger(p, 2) * 180 - escapeCost(p) +
    (route ? routeValue(p, route) * 5 : 0);
  const prediction = predictions.find(entry => entry.enemy.id === target.id);
  choice.score += prediction.options.reduce((value, next) => value + next.probability *
    (positionValue(p, next, true) - (distance(p, next) === 0 ? 12 : 0)), 0) * 0.8;
  // A diagonal chase can send both tanks into the same cell every tick.
  // Prefer preparing the turret when an enemy can contest our destination.
  if (choice.kind === 'move') choice.score -= opponents.filter(enemy =>
    distance(enemy, p) === 1 && distance(enemy, me) > 1).length * 5;
  if (choice.kind === 'shoot') choice.score += attackValue();
  if (choice.kind === 'shoot' && route && route.breach && distance(me, route.goal) === 0 &&
      aimAt(me, route.breach) === me.rotation) choice.score += 24;
  if (choice.kind === 'move') choice.score += Math.random() * 0.5;
}
candidates.sort((a, b) => b.score - a.score);
// Vary safe flanks rather than sustaining a perfectly predictable firing lane.
const flanks = candidates.filter(choice => choice.kind === 'move' &&
  bulletPathDanger(me, choice.position, 1) === 0 && bulletDanger(choice.position, 2) === 0 &&
  gunRisk(choice.position) < 3);
if (flanks.length && Math.random() < 0.12) flanks[Math.floor(Math.random() * flanks.length)].act();
else candidates[0].act();
`,
};
