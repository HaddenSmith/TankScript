import { geometryCode } from './tacticalCode.js';

export default {
  id: 'hard',
  name: 'Sidewinder (Hard)',
  color: 'orange',
  difficulty: 'hard',
  description: 'A mobile duelist that checks escape cells, muzzle threats, and firing lanes.',
  code: geometryCode + `
const target = bestTarget(me);
const aim = aimAt(me, target);
const currentRisk = bulletDanger(me, 1) * 100 + bulletDanger(me, 2) * 25 + muzzleDanger(me) * 12;
const choices = moves.map(move => {
  const position = { x: me.x + move.x, y: me.y + move.y, rotation: me.rotation };
  const risk = bulletDanger(position, 1) * 100 + bulletDanger(position, 2) * 25 + muzzleDanger(position) * 12;
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
  const choice = Math.random() < 0.04 ? choices[Math.floor(Math.random() * choices.length)] : choices[0];
  choice.move.act();
} else rotateLeft();
`,
};
