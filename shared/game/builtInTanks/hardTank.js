import { geometryCode } from './tacticalCode.js';

export default {
  id: 'hard',
  name: 'Sidewinder (Hard)',
  color: '#d97927',
  difficulty: 'hard',
  description: 'A mobile duelist that dodges bullet streams and changes contested firing lanes.',
  code: geometryCode + `
const target = bestTarget(me);
const aim = aimAt(me, target);
const currentRisk = bulletPathDanger(me, me, 1) * 1000 + bulletDanger(me, 2) * 25;
const choices = moves.map(move => {
  const position = { x: me.x + move.x, y: me.y + move.y, rotation: me.rotation };
  const risk = bulletPathDanger(me, position, 1) * 1000 + bulletDanger(position, 2) * 25;
  return { move, position, risk, score: positionValue(position, target, false) - risk };
}).filter(choice => free(choice.position)).sort((a, b) => b.score - a.score);

if (choices.length && currentRisk > choices[0].risk + 2) {
  choices[0].move.act();
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
