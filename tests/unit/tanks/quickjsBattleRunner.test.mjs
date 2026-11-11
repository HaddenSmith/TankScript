import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createTankScriptBattleRunner, createTankScriptWorkerRunner } from '../../../frontend/src/game/tank-script/tankScriptWorkerRunner.js';
import { BattleEngine } from '../../../shared/game/engine/battleEngine.js';
import { Tank } from '../../../shared/game/engine/tank.js';

const originalWorker = globalThis.Worker;
const activeWorkers = new Set();

// Run the real worker entry point with Node's message transport.
class BrowserWorker {
  constructor(url) {
    const entry = `
      import { parentPort } from 'node:worker_threads';
      globalThis.self = { postMessage: data => parentPort.postMessage(data) };
      await import(${JSON.stringify(url.href)});
      parentPort.on('message', data => self.onmessage({ data }));
    `;
    this.worker = new NodeWorker(new URL('data:text/javascript,' + encodeURIComponent(entry)));
    activeWorkers.add(this.worker);
    this.worker.on('exit', () => activeWorkers.delete(this.worker));
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', () => this.onerror?.({ preventDefault() {} }));
  }

  postMessage(data) { this.worker.postMessage(data); }
  terminate() { void this.worker.terminate(); }
}

before(() => { globalThis.Worker = BrowserWorker; });
after(async () => {
  if (originalWorker === undefined) delete globalThis.Worker;
  else globalThis.Worker = originalWorker;
  await Promise.all(Array.from(activeWorkers, worker => worker.terminate()));
});

function snapshot(tankId, overrides = {}) {
  return {
    tankId,
    tankPosition: { x: 2, y: 3 },
    tankRotation: 270,
    tankHealth: 3,
    allTanks: [
      { id: 17, name: 'One', x: 2, y: 3, rotation: 270, health: 3 },
      { id: 63, name: 'Two', x: 5, y: 3, rotation: 180, health: 3 },
    ],
    allBullets: [{ id: 1, ownerId: 17, x: 2, y: 3.5, rotation: 270 }],
    arenaWidth: 12,
    arenaHeight: 16,
    ...overrides,
  };
}

async function withBattle(tanks, run) {
  const runner = await createTankScriptBattleRunner(tanks);
  try {
    await run(runner);
  } finally {
    await runner.dispose();
  }
}

function outcomes(results) {
  return results.map(({ tankId, command, error }) => [tankId, command?.action ?? error?.code]);
}

test('keeps private state per participant and supplies fresh snapshots in caller order', async () => {
  const first = `
    globalThis.turns = (globalThis.turns ?? 0) + 1;
    try { tankPosition.x = 99; } catch {}
    if (tankId !== 17 || arenaWidth !== 12 || arenaHeight !== 16) return;
    if (turns === 1 && tankRotation === 270 && tankPosition.x === 2 && allBullets[0].y === 3.5) {
      shoot(); moveUp(); return;
    }
    if (turns === 2 && tankRotation === 90 && tankPosition.x === 4 && allBullets.length === 0 && tankHealth === 2) moveDown();
  `;
  const second = 'if (tankId === 63 && typeof globalThis.turns === "undefined") rotateLeft();';
  await withBattle([{ tankId: 17, source: first }, { tankId: 63, source: second }], async runner => {
    const firstTick = snapshot(17);
    assert.deepEqual(outcomes((await runner.runTick([snapshot(63), firstTick])).results), [
      [63, 'rotateLeft'], [17, 'shoot'],
    ]);
    assert.equal(firstTick.tankPosition.x, 2);

    const changed = snapshot(17, { tankPosition: { x: 4, y: 3 }, tankRotation: 90, allBullets: [], tankHealth: 2 });
    const { results, executionMs, workerMs } = await runner.runTick([changed, snapshot(63)]);
    assert.deepEqual(outcomes(results), [[17, 'moveDown'], [63, 'rotateLeft']]);
    assert.deepEqual((await runner.runTick([snapshot(63, { tankHealth: 0 })])).results, []);
    assert.ok(executionMs >= 0 && workerMs >= executionMs);
    assert.ok(await runner.getHeapUsageBytes() > 0);
    assert.equal((await runner.dispose()).disposedCount, 2);
    assert.equal((await runner.dispose()).disposedCount, 2);
  });
});

test('isolates compile errors, unsupported calls, exceptions and no-action results', async () => {
  await withBattle([
    { tankId: 17, source: 'return {' },
    { tankId: 63, source: 'shoot(); throw new Error("private detail");' },
    { tankId: 9, source: 'return;' },
    { tankId: 4, source: 'shoot(); teleport();' },
    { tankId: 31, source: 'moveLeft();' },
  ], async runner => {
    assert.equal(runner.initialization[0].error.code, 'COMPILE_ERROR');
    assert.ok(runner.initialization[1].timings.compilationMs >= 0);
    const { results } = await runner.runTick([17, 63, 9, 4, 31].map(id => snapshot(id)));
    assert.deepEqual(outcomes(results), [
      [17, 'COMPILE_ERROR'], [63, 'RUNTIME_ERROR'], [9, undefined],
      [4, 'RUNTIME_ERROR'], [31, 'moveLeft'],
    ]);
    assert.equal(results[1].command, undefined);
    assert.doesNotMatch(results[1].error.message, /private detail/);
    assert.equal((await runner.dispose()).disposedCount, 4);
  });
});

test('contains a tank timeout, stack error and heap error while a healthy tank still runs', async () => {
  await withBattle([
    { tankId: 17, source: 'while (true) {}' },
    { tankId: 63, source: 'function recurse() { return 1 + recurse(); } recurse();' },
    { tankId: 9, source: 'const values = new Array(2_000_000).fill(1); if (values.length) shoot();' },
    { tankId: 4, source: 'if (typeof fetch === "undefined" && typeof process === "undefined") moveRight();' },
  ], async runner => {
    const { results } = await runner.runTick([17, 63, 9, 4].map(id => snapshot(id)));
    assert.deepEqual(outcomes(results), [
      [17, 'EXECUTION_TIMEOUT'], [63, 'RUNTIME_ERROR'], [9, 'RUNTIME_ERROR'], [4, 'moveRight'],
    ]);
    assert.deepEqual(outcomes((await runner.runTick([snapshot(4)])).results), [[4, 'moveRight']]);
  });
});

test('rejects duplicate, unknown and excess participant IDs before running scripts', async () => {
  await assert.rejects(createTankScriptBattleRunner([
    { tankId: 17, source: 'shoot();' }, { tankId: 17, source: 'shoot();' },
  ]), { code: 'INVALID_BATCH' });
  await assert.rejects(createTankScriptBattleRunner(
    Array.from({ length: 13 }, (_, tankId) => ({ tankId, source: 'shoot();' })),
  ), { code: 'INVALID_BATCH' });
  await withBattle([{ tankId: 17, source: 'shoot();' }, { tankId: 63, source: 'shoot();' }], async runner => {
    await assert.rejects(runner.runTick([snapshot(99)]), { code: 'INVALID_BATCH' });
    await assert.rejects(runner.runTick([snapshot(17), snapshot(17)]), { code: 'INVALID_BATCH' });
    assert.deepEqual((await runner.runTick([])).results, []);
    assert.deepEqual(outcomes((await runner.runTick([snapshot(17)])).results), [[17, 'shoot']]);
  });
});

test('rejects an overlapping batch, settles cancellation and allows a fresh battle', async () => {
  const tanks = [{ tankId: 17, source: 'shoot();' }, { tankId: 63, source: 'moveUp();' }];
  await withBattle(tanks, async runner => {
    const batch = assert.rejects(runner.runTick([snapshot(17), snapshot(63)]), { code: 'DISPOSED' });
    const overlapping = assert.rejects(runner.runTick([snapshot(17)]), { code: 'BUSY' });
    await Promise.all([batch, overlapping, runner.dispose()]);
    await assert.rejects(runner.runTick([snapshot(17)]), { code: 'DISPOSED' });
  });
  await withBattle(tanks, async runner => {
    assert.deepEqual(outcomes((await runner.runTick([snapshot(63)])).results), [[63, 'moveUp']]);
  });
});

test('aborts a single-tank runner during startup and rejects a pre-aborted signal', async () => {
  const controller = new AbortController();
  const startup = createTankScriptWorkerRunner('shoot();', { signal: controller.signal });
  controller.abort();
  await assert.rejects(startup, { code: 'DISPOSED' });
  await assert.rejects(
    createTankScriptWorkerRunner('shoot();', { signal: controller.signal }),
    { code: 'DISPOSED' },
  );
});

test('aborting a single-tank runner settles the in-flight tick and closes it', async () => {
  const controller = new AbortController();
  const runner = await createTankScriptWorkerRunner('while (true) {}', { signal: controller.signal });
  const tick = runner.runTick(snapshot(17));
  controller.abort();
  await assert.rejects(tick, { code: 'DISPOSED' });
  await assert.rejects(runner.runTick(snapshot(17)), { code: 'DISPOSED' });
  await runner.dispose();
});

test('rejects oversized source for just that participant and aborts an in-flight battle', async () => {
  const controller = new AbortController();
  const runner = await createTankScriptBattleRunner([
    { tankId: 17, source: ' '.repeat(100_001) },
    { tankId: 63, source: 'shoot();' },
  ], { signal: controller.signal });
  try {
    assert.equal(runner.initialization[0].error.code, 'INVALID_SOURCE');
    assert.deepEqual(outcomes((await runner.runTick([snapshot(17), snapshot(63)])).results), [
      [17, 'INVALID_SOURCE'], [63, 'shoot'],
    ]);
    const tick = runner.runTick([snapshot(63)]);
    controller.abort();
    await assert.rejects(tick, { code: 'DISPOSED' });
  } finally {
    await runner.dispose();
  }
});

for (const [reason, tankSettings] of [
  ['elimination', [
    { id: 17, x: 1, code: 'shoot();' },
    { id: 63, x: 4, code: 'return;', health: 1 },
  ]],
  ['mutual-destruction', [
    { id: 17, x: 1, code: 'shoot();', health: 1 },
    { id: 63, x: 2, code: 'shoot();', health: 1, rotation: 180 },
  ]],
  ['stalemate', [
    { id: 17, x: 1, code: 'return;' },
    { id: 63, x: 4, code: 'return;' },
  ]],
]) {
  test('matches trusted engine ticks through ' + reason, async () => {
    function makeEngine() {
      const engine = new BattleEngine(8, 8);
      for (const { id, x, code, health, rotation = 0 } of tankSettings) {
        const tank = new Tank(id, 'Fixture ' + id, x, 2, code, health);
        tank.rotation = rotation;
        engine.addTank(tank);
      }
      return engine;
    }

    const trusted = makeEngine();
    const sandboxed = makeEngine();
    const participants = tankSettings.map(({ id, code }) => ({ tankId: id, source: code }));
    await withBattle(participants, async (runner) => {
      let result;
      while (!result) {
        const { results } = await runner.runTick(sandboxed.getTankScriptStates());
        assert.ok(results.every(({ error }) => !error));
        const commands = Object.fromEntries(results.map(({ tankId, command }) => [tankId, command?.action]));
        result = sandboxed.resolveTick(commands);
        assert.deepEqual(result, trusted.tick());
        assert.deepEqual(sandboxed.arena, trusted.arena);
        assert.deepEqual(sandboxed.getLastTickEvents(), trusted.getLastTickEvents());
        assert.equal(sandboxed.getTickCount(), trusted.getTickCount());
      }
      assert.equal(result.reason, reason);
    });
  });
}

test('rejects malformed initialization and terminates the worker', async () => {
  const realWorker = globalThis.Worker;
  let terminations = 0;
  globalThis.Worker = class {
    postMessage({ id }) {
      const result = { entries: [{ tankId: 0 }], wasmInitializationMs: 0 };
      queueMicrotask(() => this.onmessage({ data: { id, ok: true, result } }));
    }
    terminate() { terminations++; }
  };
  try {
    await assert.rejects(createTankScriptWorkerRunner('shoot();'), { code: 'WORKER_ERROR' });
    assert.equal(terminations, 1);
  } finally {
    globalThis.Worker = realWorker;
  }
});

test('ignores uncorrelated worker messages and rejects an unknown request', { timeout: 5_000 }, async () => {
  const worker = new BrowserWorker(new URL('../../../frontend/src/game/tank-script/quickjsTankWorker.js', import.meta.url));
  try {
    const reply = new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => resolve(data);
      worker.onerror = () => reject(new Error('Unexpected worker error'));
    });
    worker.postMessage(null);
    worker.postMessage({ id: 1, type: 'unknown' });
    assert.deepEqual(await reply, { id: 1, ok: false });
  } finally {
    worker.terminate();
  }
});
