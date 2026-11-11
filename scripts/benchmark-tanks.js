// Development only: exercise the actual engine and executor, with repeatable RNG.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BattleEngine } from '../shared/game/engine/battleEngine.js';
import { Tank } from '../shared/game/engine/tank.js';

const tiers = ['easy', 'medium', 'hard', 'expert', 'overkill'];
let definitions = await Promise.all(tiers.map(async tier =>
  (await import(`../shared/game/builtInTanks/${tier}Tank.js`)).default));
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf('--' + name);
  return index < 0 ? fallback : args[index + 1];
}
const samples = Number(option('samples', 100));
const ffaSamples = Number(option('ffa', 50));
const baseSeed = Number(option('seed', 7193));
if (!Number.isInteger(samples) || samples < 2 || samples % 2 || !Number.isInteger(ffaSamples) || ffaSamples < 0) {
  throw new Error('Use an even --samples >= 2 and --ffa >= 0.');
}
const output = option('out', 'benchmarks/latest.json');
if (option('codes', null)) definitions = JSON.parse(readFileSync(option('codes'), 'utf8'));
if (option('save-codes', null)) {
  mkdirSync(path.dirname(option('save-codes')), { recursive: true });
  writeFileSync(option('save-codes'), JSON.stringify(definitions, null, 2) + '\n');
}
function randomSource(seed) {
  return () => {
    // Mulberry32 mixes consecutive seeds, including their first draw.
    seed = (seed + 0x6D2B79F5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function scenario(index) {
  const size = [8, 12, 16, 20][Math.floor(index / 5) % 4];
  const random = randomSource(baseSeed + index);
  const randomPositions = [];
  while (randomPositions.length < 2) {
    const p = [Math.floor(random() * size), Math.floor(random() * size)];
    if (!randomPositions.some(other => other[0] === p[0] && other[1] === p[1])) randomPositions.push(p);
  }
  const layouts = [
    [[1, 1], [size - 2, size - 2]],
    [[1, Math.floor(size / 2)], [size - 2, Math.floor(size / 2)]],
    [[Math.floor(size / 2), 2], [Math.floor(size / 2) + 1, 3]],
    [[0, size - 1], [size - 1, 0]],
    randomPositions,
  ];
  return { size, positions: layouts[index % layouts.length],
    rotations: [0, 1].map(() => Math.floor(random() * 4) * 90) };
}
function battle(participants, setup, seed) {
  const originalRandom = Math.random;
  const originalError = console.error;
  const errors = [];
  Math.random = randomSource(seed);
  console.error = (...args) => errors.push(args.map(String).join(' '));
  try {
    const engine = new BattleEngine(setup.size, setup.size);
    const deathTicks = new Map();
    let shots = 0;
    const runtime = participants.map((definition, index) => {
      const [x, y] = setup.positions[index];
      const tank = new Tank(index + 1, definition.name, x, y, definition.code, 3, definition.color);
      tank.rotation = setup.rotations[index];
      // Observe public actions without replacing their implementation.
      const shoot = tank.shoot.bind(tank);
      tank.shoot = id => { shots++; return shoot(id); };
      engine.addTank(tank);
      return tank;
    });
    let result;
    do {
      result = engine.tick();
      if (errors.length) throw new Error(errors.join('\n'));
      if (option('trace', null)) console.log(JSON.stringify({ tick: engine.getTickCount(),
        tanks: runtime.map(({ id, x, y, rotation, health }) => ({ id, x, y, rotation, health })),
        bullets: engine.arena.bullets }));
      runtime.forEach(tank => {
        if (!tank.isAlive() && !deathTicks.has(tank.id)) deathTicks.set(tank.id, engine.getTickCount());
      });
      if (runtime.some(tank => tank.x < 0 || tank.x >= setup.size || tank.y < 0 || tank.y >= setup.size)) {
        throw new Error('Tank escaped the arena');
      }
    } while (!result);
    return { winner: result.winner ? result.winner.id - 1 : null, reason: result.reason,
      ticks: result.tickCount, shots,
      tanks: runtime.map((tank, index) => ({ tier: participants[index].id, kills: tank.killCount,
        survival: deathTicks.get(tank.id) ?? result.tickCount, health: tank.health })) };
  } finally { Math.random = originalRandom; console.error = originalError; }
}
function summarize(matches, participants) {
  return {
    matches: matches.length,
    ties: matches.filter(match => match.winner === null).length,
    stalemates: matches.filter(match => match.reason === 'stalemate').length,
    timeouts: matches.filter(match => match.reason === 'timeout').length,
    averageTicks: matches.reduce((sum, match) => sum + match.ticks, 0) / matches.length,
    averageShots: matches.reduce((sum, match) => sum + match.shots, 0) / matches.length,
    tanks: participants.map((definition, index) => {
      const wins = matches.filter(match => match.winner === index).length;
      const losses = matches.filter(match => match.winner !== null && match.winner !== index).length;
      return { tier: definition.id, wins, losses,
        decisiveWinRate: wins + losses ? wins / (wins + losses) : null,
        averageSurvival: matches.reduce((sum, match) => sum + match.tanks[index].survival, 0) / matches.length,
        averageKills: matches.reduce((sum, match) => sum + match.tanks[index].kills, 0) / matches.length };
    }),
  };
}
if (option('trace', null)) {
  const [a, b, index = '0'] = option('trace').split(',');
  battle([a, b].map(id => definitions.find(tank => tank.id === id)), scenario(Number(index)), baseSeed + 91437 + Number(index));
  process.exit(0);
}
const report = { configuration: { samples, ffaSamples, seed: baseSeed, health: 3,
  sizes: [8, 12, 16, 20], maxTicks: BattleEngine.MAX_TICKS,
  stalemateTicks: BattleEngine.MAX_NO_PROGRESS_TICKS }, headToHead: [], freeForAll: null };
for (let a = 0; a < definitions.length; a++) {
  for (let b = a + 1; b < definitions.length; b++) {
    const participants = [definitions[a], definitions[b]];
    if (option('pair', null) && participants.map(tank => tank.id).join(',') !== option('pair')) continue;
    const matches = [];
    for (let index = 0; index < samples / 2; index++) {
      const setup = scenario(index);
      for (const reverse of [false, true]) {
        const balanced = reverse ? { ...setup, positions: [...setup.positions].reverse(),
          rotations: [...setup.rotations].reverse() } : setup;
        matches.push(battle(participants, balanced, baseSeed + 91437 + index));
      }
    }
    const summary = summarize(matches, participants);
    report.headToHead.push({ ...summary, results: matches });
    console.log(`${participants.map(tank => tank.id).join(' vs ')}: ${summary.tanks.map(tank => tank.wins).join('-')}-${summary.ties} (W-W-T), ${summary.stalemates} stalemates`);
  }
}
const ffaMatches = [];
for (let index = 0; index < ffaSamples; index++) {
  const size = [8, 12, 16, 20][Math.floor(index / 5) % 4];
  const positions = [[1, 1], [size - 2, 1], [size - 2, size - 2], [1, size - 2],
    [Math.floor(size / 2), Math.floor(size / 2)]];
  ffaMatches.push(battle(definitions, { size,
    positions: definitions.map((_, i) => positions[(i + index) % 5]),
    rotations: definitions.map((_, i) => ((i + index) % 4) * 90) }, baseSeed + 49157 + Math.floor(index / 5)));
}
if (ffaMatches.length) report.freeForAll = { ...summarize(ffaMatches, definitions), results: ffaMatches };
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Saved ${path.resolve(output)}`);
