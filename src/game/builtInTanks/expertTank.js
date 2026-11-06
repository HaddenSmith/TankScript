import { geometryCode } from './tacticalCode.js';

export default {
  id: 'expert',
  name: 'Prism (Expert)',
  color: '#7952a3',
  difficulty: 'expert',
  description: 'Scores every action, avoids converging fire, and changes firing lanes.',
  code: geometryCode + `
const target = bestTarget(me);
const choices = [
  { position: me, act: shoot, kind: 'shoot' },
  { position: { ...me, rotation: (me.rotation + 90) % 360 }, act: rotateLeft, kind: 'turn' },
  { position: { ...me, rotation: (me.rotation + 270) % 360 }, act: rotateRight, kind: 'turn' },
  ...moves.map(move => ({ position: { x: me.x + move.x, y: me.y + move.y, rotation: me.rotation },
    act: move.act, kind: 'move' })).filter(choice => free(choice.position)),
];
for (const choice of choices) {
  const p = choice.position;
  // An arrival at our old cell is unavoidable for every action. Charge it
  // equally so moving out of a stream is not penalized more than staying.
  choice.score = positionValue(p, target, false) - bulletPathDanger(me, p, 1) * 1000 -
    bulletDanger(p, 2) * 30 - bulletDanger(p, 3) * 8 -
    muzzleDanger(p) * (tankHealth < 3 ? 10 : 4);
  if (choice.kind === 'shoot') {
    const victim = opponents.find(enemy => aimAt(me, enemy) === me.rotation && clearShot(me, enemy));
    choice.score += victim && !shotScreened(victim) ? 7 / distance(me, victim) - 2 : -8;
    if (!victim && canSuppress(target)) choice.score += 14;
  }
  if (choice.kind === 'move') choice.score += Math.random() * 0.7;
}
choices.sort((a, b) => b.score - a.score);
// Small, safe variation prevents permanent repeated positioning patterns.
const alternatives = choices.filter(choice => choice.kind === 'move' &&
  bulletDanger(choice.position, 1) === 0 && bulletDanger(choice.position, 2) === 0 &&
  bulletPathDanger(me, choice.position, 1) === 0 && muzzleDanger(choice.position) < 0.3);
if (alternatives.length && Math.random() < 0.035) {
  alternatives[Math.floor(Math.random() * alternatives.length)].act();
} else choices[0].act();
`,
};
