import { createBattleFromSelectedTanks } from '../../src/battle/battleController.js';
import { Bullet } from '../../src/game/engine/bullet.js';
import { builtInTanks } from '../../src/game/builtInTanks/builtInTanks.js';
import { createTankScriptBattleRunner } from '../../src/game/tank-script/tankScriptWorkerRunner.js';
import { TANK_SCRIPT_ACTIONS } from '../../src/game/tank-script/tankScriptRunnerProtocol.js';

const warmupTicks = 8;
const measuredTicks = 160;
const ticksPerRound = 42;
const tickIntervalMs = 125;

function seededRandom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function seedBullets(engine, count, random) {
  const occupied = new Set();
  while (occupied.size < count) {
    const rotation = Math.floor(random() * 4) * 90;
    const horizontal = rotation === 0 || rotation === 180;
    const x = Math.floor(random() * (engine.arena.width - Number(horizontal))) + (horizontal ? 0.5 : 0);
    const y = Math.floor(random() * (engine.arena.height - Number(!horizontal))) + (horizontal ? 0 : 0.5);
    const key = `${x},${y}`;
    if (occupied.has(key)) continue;
    const owner = engine.arena.tanks[occupied.size % engine.arena.tanks.length];
    engine.arena.addBullet(new Bullet(engine.nextBulletId++, owner.id, x, y, rotation));
    occupied.add(key);
  }
}

function captureState(engine) {
  const { tanks, bullets, width, height } = engine.arena;
  const allTanks = tanks.map(({ id, name, x, y, rotation, health }) => ({ id, name, x, y, rotation, health }));
  const allBullets = bullets.map(({ id, ownerId, x, y, rotation }) => ({ id, ownerId, x, y, rotation }));
  return allTanks.filter(tank => tank.health > 0).map(tank => ({
    tankId: tank.id,
    tankPosition: { x: tank.x, y: tank.y },
    tankRotation: tank.rotation,
    tankHealth: tank.health,
    allTanks,
    allBullets,
    arenaWidth: width,
    arenaHeight: height,
  }));
}

function captureTrace(definitions, arenaSize, initialBullets, seed) {
  const trace = [];
  const originalRandom = Math.random;
  const random = seededRandom(seed);
  // The trusted engine generates the same input sequence across lab runs.
  Math.random = random;
  try {
    while (trace.length < warmupTicks + measuredTicks) {
      const engine = createBattleFromSelectedTanks(definitions, arenaSize);
      for (const tank of engine.arena.tanks) tank.rotation = Math.floor(random() * 4) * 90;
      seedBullets(engine, initialBullets, random);
      for (let tick = 0; tick < ticksPerRound && trace.length < warmupTicks + measuredTicks; tick++) {
        const states = captureState(engine);
        const startedAt = performance.now();
        const result = engine.tick();
        trace.push({ states, engineMs: performance.now() - startedAt });
        if (result) break;
      }
    }
  } finally {
    Math.random = originalRandom;
  }
  return trace;
}

function rounded(number) {
  return Number(number.toFixed(2));
}

function latency(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = fraction => rounded(sorted[Math.ceil(fraction * sorted.length) - 1]);
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), worst: at(1) };
}

async function measureScenario({ name, definitions, arenaSize, initialBullets = 0 }, seed) {
  const trace = captureTrace(definitions, arenaSize, initialBullets, seed);
  const participants = definitions.map((tank, index) => ({ tankId: index + 1, source: tank.code }));
  const startedAt = performance.now();
  const runner = await createTankScriptBattleRunner(participants);
  const workerReadyMs = performance.now() - startedAt;
  const roundTrips = [];
  const workerExecution = [];
  const hostAndTransit = [];
  const heapSamples = [];
  let disposal;
  let disposeRoundTripMs;
  let noActions = 0;
  const errors = {};
  try {
    if (runner.initialization.some(entry => entry.error)) throw new Error(name + ' failed to compile');
    heapSamples.push(await runner.getHeapUsageBytes());
    for (const [index, { states }] of trace.entries()) {
      const startedAt = performance.now();
      const { results, executionMs, workerMs } = await runner.runTick(states);
      const elapsed = performance.now() - startedAt;

      if (results.length !== states.length || results.some(result =>
        result.command && !TANK_SCRIPT_ACTIONS.includes(result.command.action))) {
        throw new Error(name + ' returned an invalid command batch at sample ' + index);
      }
      for (const { command, error } of results) {
        if (error) errors[error.code] = (errors[error.code] ?? 0) + 1;
        else if (index >= warmupTicks && !command) noActions++;
      }
      if (index < warmupTicks) continue;
      roundTrips.push(elapsed);
      workerExecution.push(executionMs);
      hostAndTransit.push(Math.max(0, elapsed - workerMs));
      if (roundTrips.length % 40 === 0) heapSamples.push(await runner.getHeapUsageBytes());
    }
  } finally {
    const startedAt = performance.now();
    disposal = await runner.dispose();
    disposeRoundTripMs = performance.now() - startedAt;
  }
  if (disposal?.disposedCount !== definitions.length) throw new Error(name + ' failed to dispose all runtimes');

  const measuredTrace = trace.slice(warmupTicks);
  return {
    scenario: name,
    arenaSize,
    ticks: measuredTicks,
    livingTankRange: [
      Math.min(...measuredTrace.map(({ states }) => states.length)),
      Math.max(...measuredTrace.map(({ states }) => states.length)),
    ],
    peakBullets: Math.max(...measuredTrace.map(({ states }) => states[0].allBullets.length)),
    noActions,
    errorsIncludingWarmup: errors,
    workerReadyMs: rounded(workerReadyMs),
    wasmInitializationMs: rounded(runner.wasmInitializationMs),
    tankInitialization: runner.initialization.map(({ tankId, timings }) => ({
      tankId,
      runtimeMs: rounded(timings.initializationMs),
      compileMs: rounded(timings.compilationMs),
    })),
    batchRoundTripMs: latency(roundTrips),
    totalCommandCollectionMs: rounded(roundTrips.reduce((sum, value) => sum + value, 0)),
    over125Ms: roundTrips.filter(elapsed => elapsed > tickIntervalMs).length,
    quickJSExecutionMs: latency(workerExecution),
    hostAndTransitMs: latency(hostAndTransit),
    existingFullEngineTickMs: latency(measuredTrace.map(({ engineMs }) => engineMs)),
    sampledGuestHeapBytes: Math.max(...heapSamples),
    workerCleanupMs: rounded(disposal.cleanupMs),
    disposeRoundTripMs: rounded(disposeRoundTripMs),
  };
}

export async function benchmarkBattles(onResult) {
  const checkmate = builtInTanks.find(tank => tank.id === 'overkill');
  const prism = builtInTanks.find(tank => tank.id === 'expert');
  const scenarios = [
    { name: '2 tanks', definitions: [prism, checkmate], arenaSize: 8 },
    { name: '5 official tanks', definitions: builtInTanks, arenaSize: 12 },
    { name: '12 mixed tanks', definitions: Array.from({ length: 12 }, (_, i) => builtInTanks[i % 5]), arenaSize: 20 },
    { name: '12 Checkmates, bullet-heavy', definitions: Array(12).fill(checkmate), arenaSize: 20, initialBullets: 72 },
  ];
  const measurements = [];
  for (const [index, scenario] of scenarios.entries()) {
    const result = await measureScenario(scenario, 7193 + index);
    measurements.push(result);
    onResult(result);
  }
  return measurements;
}
