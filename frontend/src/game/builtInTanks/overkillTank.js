import { geometryCode } from './tacticalCode.js';

export default {
  id: 'overkill',
  name: 'Checkmate (Overkill)',
  color: '#b84579',
  difficulty: 'overkill',
  description: 'Closes from safe angles, anticipates escape lanes, and plans around converging fire.',
  code: geometryCode + `
const target = bestTarget(me);
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
      rotation: enemy.rotation, kind: 'move' })).filter(p => inside(p) &&
      !allTanks.some(tank => tank.id !== enemy.id && tank.x === p.x && tank.y === p.y)),
  ];
  for (const p of options) {
    const d = distance(p, me);
    const alignment = Math.min(Math.abs(p.x - me.x), Math.abs(p.y - me.y));
    p.score = -d * 1.5 - alignment * 2 - approachTurns(p, me) -
      bulletPathDanger(enemy, p, 1) * 1000 - bulletDanger(p, 2) * 30;
    if (aimAt(me, p) === me.rotation && d === 1) p.score -= 4;
    if (p.kind === 'shoot') {
      if (aimAt(p, me) === p.rotation) p.score += 7 / d - 2;
      else if (d === 2 && alignment === 1 && approachTurns(p, me) === 0) p.score += 6;
      else p.score -= 8;
    }
  }
  const best = Math.max(...options.map(p => p.score));
  const sum = options.reduce((total, p) => total + Math.exp((p.score - best) / 1.5), 0);
  return options.map(p => ({ ...p, probability: Math.exp((p.score - best) / 1.5) / sum }));
}
const predictions = opponents.map(enemy => ({ enemy, options: forecast(enemy) }));

function gunRisk(position) {
  return opponents.reduce((risk, enemy) => {
    if (aimAt(enemy, position) !== enemy.rotation) return risk;
    const d = distance(enemy, position);
    // Accept a favorable trade, but avoid gambling the last health point.
    const contact = tankHealth === 1 ? 70 : tankHealth > enemy.health ? 10 :
      tankHealth < enemy.health || tankHealth === 2 ? 32 : 16;
    return risk + (d === 1 ? contact : d === 2 ? 2 : 0.1);
  }, 0);
}

// Search reachable escape cells two decisions ahead. Unlike a stationary
// forecast, each edge checks the entire move against the engine's bullet phase.
function escapeCost(start) {
  let frontier = [{ position: start, cost: 0 }];
  for (let tick = 2; tick <= 3; tick++) {
    const next = new Map();
    for (const node of frontier) {
      const destinations = [node.position, ...moves.map(move => ({
        x: node.position.x + move.x, y: node.position.y + move.y, rotation: start.rotation,
      })).filter(free)];
      for (const position of destinations) {
        const cost = node.cost + bulletPathDanger(node.position, position, tick) * 500 / tick;
        const key = position.x + ',' + position.y;
        if (!next.has(key) || cost < next.get(key).cost) next.set(key, { position, cost });
      }
    }
    frontier = [...next.values()];
  }
  return Math.min(...frontier.map(node => node.cost));
}

function attackValue() {
  let reward = -10;
  for (const enemy of opponents) {
    const d = distance(me, enemy);
    if (aimAt(me, enemy) === me.rotation && clearShot(me, enemy) && !shotScreened(enemy)) {
      reward = Math.max(reward, (d === 1 ? 18 : d === 2 ? 4 : -3) + (4 - exits(enemy)));
    }
    // Estimate the opponent's approach rather than shooting at every possible
    // cell. Predictions use only public positions, turrets and current bullets.
    const options = moves.map(move => ({ x: enemy.x + move.x, y: enemy.y + move.y }))
      .filter(position => inside(position) && !allTanks.some(tank => tank.x === position.x && tank.y === position.y));
    for (const position of options) {
      if (distance(position, me) >= d || aimAt(me, position) !== me.rotation) continue;
      if (distance(me, position) > 2) continue;
      reward = Math.max(reward, 8);
    }
  }
  const direction = vector(me.rotation);
  const impact = { x: me.x + direction.x, y: me.y + direction.y };
  // A new shot reaches this cell next tick, so an opponent stepping here now
  // cannot wait until the following decision to dodge it.
  for (const { enemy, options } of predictions) {
    if (!clearShot(me, impact)) continue;
    const probability = options.filter(p => p.x === impact.x && p.y === impact.y)
      .reduce((total, p) => total + p.probability, 0);
    reward = Math.max(reward, probability * (enemy.health === 1 ? 45 : 30) - 2);
  }
  return reward;
}

for (const choice of candidates) {
  const p = choice.position;
  choice.score = positionValue(p, target, true) - approachTurns(p, target) * 3 - gunRisk(p) -
    bulletPathDanger(me, p, 1) * 1000 - bulletDanger(p, 2) * 180 - escapeCost(p);
  const prediction = predictions.find(entry => entry.enemy.id === target.id);
  choice.score += prediction.options.reduce((value, next) => value + next.probability *
    (positionValue(p, next, true) - (distance(p, next) === 0 ? 12 : 0)), 0) * 0.8;
  // A diagonal chase can send both tanks into the same cell every tick.
  // Prefer preparing the turret when an enemy can contest our destination.
  if (choice.kind === 'move') choice.score -= opponents.filter(enemy =>
    distance(enemy, p) === 1 && distance(enemy, me) > 1).length * 5;
  if (choice.kind === 'shoot') choice.score += attackValue();
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
