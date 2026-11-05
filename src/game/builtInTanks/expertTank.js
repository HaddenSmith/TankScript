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
  choice.score = positionValue(p, target, false) - bulletDanger(p, 1) * 250 -
    bulletDanger(p, 2) * 30 - bulletDanger(p, 3) * 8 - muzzleDanger(p) * 6;
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
  muzzleDanger(choice.position) < 0.3);
if (alternatives.length && Math.random() < 0.035) {
  alternatives[Math.floor(Math.random() * alternatives.length)].act();
} else choices[0].act();
`,
};
