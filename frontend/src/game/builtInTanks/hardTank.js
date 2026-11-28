import { geometryCode } from './tacticalCode.js';

export default {
  id: 'hard',
  name: 'Sidewinder (Hard)',
  color: '#d97927',
  difficulty: 'hard',
  description: 'A mobile duelist that routes around cover, dodges streams, and collects nearby upgrades.',
  code: geometryCode + `
const target = bestTarget(me);
let route = null;
if (walls.length || pickups.length) {
  const paths = routeDistances(me);
  const heart = nearestPickup('heart', paths);
  const lightning = nearestPickup('lightning', paths);
  let pickup = null;
  if (tankHealth < maximumHealth && heart && heart.steps <= 4) pickup = heart;
  else if (lightning && lightning.steps <= 3 && lightningRemaining <= lightning.steps + 5) pickup = lightning;
  route = pickup ? { goal: pickup, pickup, breach: null, distances: routeDistances(pickup) } : combatRoute(target, false, paths);
}
const aim = aimAt(me, target);
const currentRisk = bulletPathDanger(me, me, 1) * 1000 + bulletDanger(me, 2) * 25;
const choices = moves.map(move => {
  const position = { x: me.x + move.x, y: me.y + move.y, rotation: me.rotation };
  const risk = bulletPathDanger(me, position, 1) * 1000 + bulletDanger(position, 2) * 25;
  return { move, position, risk, score: positionValue(position, target, false) - risk + (route ? routeValue(position, route) * 3 : 0) };
}).filter(choice => free(choice.position)).sort((a, b) => b.score - a.score);

if (choices.length && currentRisk > choices[0].risk + 2) {
  choices[0].move.act();
} else if (route && route.pickup && choices.length && choices[0].risk <= currentRisk &&
    routeValue(choices[0].position, route) > routeValue(me, route)) {
  choices[0].move.act();
} else if (route && route.breach && distance(me, route.goal) === 0) {
  const wallAim = aimAt(me, route.breach);
  if (wallAim === me.rotation) shoot();
  else turnTo(wallAim);
} else if (aim !== null && clearShot(me, target)) {
  if (aim === me.rotation && shotScreened(target) && choices.length) {
    const flank = choices.find(choice => aimAt(choice.position, target) === null && choice.risk < 10);
    if (flank) flank.move.act();
    else shoot();
  } else if (aim === me.rotation) shoot();
  else turnTo(aim);
} else if (canSuppress(target) && Math.random() < 0.4 && currentRisk < 10) {
  shoot();
} else if (choices.length) {
  // Occasional flanking breaks deterministic traffic jams.
  const safe = choices.filter(choice => bulletPathDanger(me, choice.position, 1) === 0 && choice.risk < 25);
  const choice = safe.length && Math.random() < 0.04 ? safe[Math.floor(Math.random() * safe.length)] : choices[0];
  choice.move.act();
} else rotateLeft();
`,
};
