import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectTankRunner, startDockerTankRunner } from './client.js';
import firefly from '../../src/game/builtInTanks/easyTank.js';
import bloodhound from '../../src/game/builtInTanks/mediumTank.js';
import sidewinder from '../../src/game/builtInTanks/hardTank.js';
import prism from '../../src/game/builtInTanks/expertTank.js';
import checkmate from '../../src/game/builtInTanks/overkillTank.js';

// Only the benchmark imports the existing engine, to replay trusted official fixtures.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !extname(specifier)) {
      const url = new URL(specifier + '.js', context.parentURL);
      if (existsSync(url)) return nextResolve(url.href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { createBattleFromSelectedTanks } = await import('../../src/battle/battleController.js');
const { Bullet } = await import('../../src/game/engine/bullet.js');
hooks.deregister();

const warmupTicks = 8;
const measuredTicks = 160;
const localFixtures = process.argv[2] === '--local-fixtures';
if (process.argv.length > 2 && (!localFixtures || process.argv.length > 3)) {
  throw new Error('Use no arguments for Docker or --local-fixtures for the trusted benchmark.');
}

function seedRandom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function addBullets(engine, count, random) {
  const occupied = new Set();
  while (occupied.size < count) {
    const rotation = Math.floor(random() * 4) * 90;
    const horizontal = rotation % 180 === 0;
    const x = Math.floor(random() * (engine.arena.width - Number(horizontal))) + (horizontal ? 0.5 : 0);
    const y = Math.floor(random() * (engine.arena.height - Number(!horizontal))) + (horizontal ? 0 : 0.5);
    const key = x + ',' + y;
    if (occupied.has(key)) continue;
    const owner = engine.arena.tanks[occupied.size % engine.arena.tanks.length];
    engine.arena.addBullet(new Bullet(engine.nextBulletId++, owner.id, x, y, rotation));
    occupied.add(key);
  }
}

function trace(definitions, size, initialBullets, seed) {
  const states = [];
  const originalRandom = Math.random;
  const random = seedRandom(seed);
  Math.random = random;
  try {
    while (states.length < warmupTicks + measuredTicks) {
      const engine = createBattleFromSelectedTanks(definitions, size);
      for (const tank of engine.arena.tanks) tank.rotation = Math.floor(random() * 4) * 90;
      addBullets(engine, initialBullets, random);
      for (let tick = 0; tick < 42 && states.length < warmupTicks + measuredTicks; tick++) {
        states.push(engine.getTankScriptStates());
        if (engine.tick()) break;
      }
    }
  } finally {
    Math.random = originalRandom;
  }
  return states;
}

const rounded = value => Number(value.toFixed(2));

function latency(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = fraction => rounded(sorted[Math.ceil(sorted.length * fraction) - 1]);
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), worst: at(1) };
}

async function openRunner(tanks) {
  if (!localFixtures) return startDockerTankRunner(tanks);

  const runnerFile = fileURLToPath(new URL('./runner.js', import.meta.url));
  const child = spawn(process.execPath, [runnerFile], { env: {}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  return connectTankRunner(child, tanks);
}

async function measure(name, definitions, size, initialBullets, seed) {
  const states = trace(definitions, size, initialBullets, seed);
  const tanks = definitions.map(({ code }, i) => ({ tankId: i + 1, source: code }));
  const started = performance.now();
  const runner = await openRunner(tanks);
  const readyMs = performance.now() - started;
  const wall = [];
  const execution = [];
  let usage;
  let cleanupMs;
  try {
    if (runner.initialization.some(({ error }) => error)) throw new Error('Official tank initialization failed.');
    for (const [index, batch] of states.entries()) {
      const tickStarted = performance.now();
      const result = await runner.runTick(batch);
      const elapsed = performance.now() - tickStarted;
      if (result.results.some(({ error }) => error)) throw new Error('Official tank returned a runner error.');
      if (index < warmupTicks) continue;
      wall.push(elapsed);
      execution.push(result.executionMs);
    }
    usage = await runner.getStats();
  } finally {
    const cleanupStarted = performance.now();
    await runner.dispose();
    cleanupMs = performance.now() - cleanupStarted;
  }

  return {
    name,
    size,
    ticks: wall.length,
    peakBullets: Math.max(...states.map(batch => batch[0].allBullets.length)),
    readyMs: rounded(readyMs),
    wasmInitializationMs: rounded(runner.wasmInitializationMs),
    perTankInitialization: runner.initialization.map(({ tankId, timings }) => ({
      tankId,
      runtimeMs: rounded(timings.initializationMs),
      compileMs: rounded(timings.compilationMs),
    })),
    roundTripMs: latency(wall),
    quickjsMs: latency(execution),
    over125Ms: wall.filter(value => value > 125).length,
    cleanupMs: rounded(cleanupMs),
    usage,
  };
}

const official = [firefly, bloodhound, sidewinder, prism, checkmate]
  .sort((first, second) => first.name.localeCompare(second.name));
console.log(JSON.stringify({ transport: localFixtures ? 'trusted local process fixtures' : 'restricted Docker' }));
for (const [i, [name, definitions, size, bullets]] of [
  ['2 tanks', [prism, checkmate], 8, 0],
  ['5 official tanks', official, 12, 0],
  ['12 mixed tanks', Array.from({ length: 12 }, (_, i) => official[i % official.length]), 20, 0],
  ['12 Checkmates, seeded bullets', Array(12).fill(checkmate), 20, 72],
].entries()) {
  console.log(JSON.stringify(await measure(name, definitions, size, bullets, 7193 + i)));
}
