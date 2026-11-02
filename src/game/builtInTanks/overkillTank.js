import { geometryCode } from './tacticalCode.js';

export default {
  id: 'overkill',
  name: 'Checkmate (Overkill)',
  color: 'magenta',
  difficulty: 'overkill',
  description: 'Plans escape routes, pursues close firing positions, and suppresses escape lanes.',
  code: geometryCode + `
// Replan from public snapshots every tick. No hidden state or extra actions.
const target = bestTarget(me);
const candidates = [
  { position: me, act: shoot, kind: 'shoot' },
  { position: { ...me, rotation: (me.rotation + 90) % 360 }, act: rotateLeft, kind: 'turn' },
  { position: { ...me, rotation: (me.rotation + 270) % 360 }, act: rotateRight, kind: 'turn' },
  ...moves.map(move => ({ position: { x: me.x + move.x, y: me.y + move.y, rotation: me.rotation },
    act: move.act, kind: 'move' })).filter(choice => free(choice.position)),
];

function danger(position, tick) {
  const caution = tankHealth === 1 ? 12 : tankHealth === 2 ? 5 : 1.5;
  return bulletDanger(position, tick) * 1000 + muzzleDanger(position) * caution;
}

// A bounded search over future movement, including staying in place. A cell
// safe now may be a dead end when two bullet streams arrive together.
// Merge equivalent positions at each depth to keep the work small.
function escapeValue(start) {
  let frontier = [{ position: start, cost: 0 }];
  for (let tick = 2; tick <= 4; tick++) {
    const next = new Map();
    for (const node of frontier) {
      const destinations = [node.position, ...moves.map(move => ({
        x: node.position.x + move.x, y: node.position.y + move.y, rotation: start.rotation,
      })).filter(free)];
      for (const position of destinations) {
        const cost = node.cost + danger(position, tick) / tick;
        const key = position.x + ',' + position.y;
        if (!next.has(key) || cost < next.get(key).cost) next.set(key, { position, cost });
      }
    }
    frontier = [...next.values()];
  }
  return Math.max(...frontier.map(node => positionValue(node.position, target, true) * 0.45 - node.cost));
}

function shotValue() {
  const pressure = allBullets.filter(bullet => bullet.ownerId === tankId &&
    bullet.rotation === me.rotation && aimAt(me, bullet) === me.rotation && distance(me, bullet) <= 4).length;
  let reward = 0;
  for (const enemy of opponents) {
    const aim = aimAt(me, enemy);
    const d = distance(me, enemy);
    if (aim === me.rotation && clearShot(me, enemy)) {
      if (shotScreened(enemy)) continue;
      // An adjacent opponent has one decision before impact. Staying close
      // makes dodging costly and puts pressure on cornered opponents.
      const mobility = exits(enemy);
      const urgency = enemy.health === 1 ? 1.35 : 1;
      reward = Math.max(reward, (d === 1 ? 12 : d === 2 ? 3 : -2) * urgency + (4 - mobility));
    } else {
      // Suppress a reachable escape cell, even when the target is diagonal.
      for (const move of moves) {
        const next = { x: enemy.x + move.x, y: enemy.y + move.y };
        if (inside(next) && aimAt(me, next) === me.rotation && distance(me, next) <= 3) {
          reward = Math.max(reward, 9);
        }
      }
    }
  }
  // Once a stream is established, move to build a second angle rather than
  // spending the entire battle reinforcing one easily dodged line.
  return (reward || -7) - (pressure >= 3 ? 12 : 0);
}

for (const choice of candidates) {
  const p = choice.position;
  choice.score = positionValue(p, target, true) + escapeValue(p) - danger(p, 1);
  if (choice.kind === 'shoot') choice.score += shotValue();
  // Prefer routes with several exits; avoid committing to a single dodge cell.
  if (choice.kind === 'move') {
    choice.score += Math.random() * 1.1;
    // Another tank may choose this same destination simultaneously.
    choice.score -= opponents.filter(enemy => distance(enemy, p) === 1).length * 0.45;
    // When diagonal, reserve both likely lineup cells as uncertain. Random
    // tie breaking then stops two pursuers requesting the same cell forever.
    if (distance(me, target) === 2 && aimAt(me, target) === null && distance(p, target) === 1) {
      choice.score += Math.random() * 6;
    }
  }
}
candidates.sort((a, b) => b.score - a.score);

// Randomized flank attempts provide an escape from symmetric movement loops.
// No tick counter or storage is available, so this is probabilistic rather
// than a claim to detect elapsed time or guarantee a win against every bot.
const flanks = candidates.filter(choice => choice.kind === 'move' && danger(choice.position, 1) < 3 &&
  bulletDanger(choice.position, 2) === 0 && choice.score >= candidates[0].score - 18);
if (flanks.length && Math.random() < 0.06) flanks[Math.floor(Math.random() * flanks.length)].act();
else candidates[0].act();
`,
};
