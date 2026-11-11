import { createTankScriptBattleRunner, createTankScriptWorkerRunner } from '../../frontend/src/game/tank-script/tankScriptWorkerRunner.js';
import { benchmarkBattles } from './quickjs-battle-benchmark.js';
import { builtInTanks } from '../../frontend/src/game/builtInTanks/builtInTanks.js';

const allTanks = builtInTanks.map((tank, index) => ({
  id: index + 1,
  name: tank.name,
  x: 1 + index * 3,
  y: 2 + index,
  rotation: index % 4 * 90,
  health: 3,
}));

function makeSnapshot(tank = allTanks[0]) {
  return {
    tankId: tank.id,
    tankPosition: { x: tank.x, y: tank.y },
    tankRotation: tank.rotation,
    tankHealth: tank.health,
    allTanks,
    allBullets: [{ id: 1, ownerId: 2, x: 2.5, y: 2, rotation: 180 }],
    arenaWidth: 20,
    arenaHeight: 20,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectError(promise, code) {
  try {
    await promise;
  } catch (error) {
    assert(error.code === code, `Expected ${code}, received ${error.code ?? error.message}`);
    return;
  }
  throw new Error(`Expected ${code}`);
}

async function checkRealWorker() {
  const startedAt = performance.now();
  const runner = await createTankScriptWorkerRunner(`
    if (tankHealth === 2) while (true) {}
    if (tankRotation === 90) {
      function recurse() { return 1 + recurse(); }
      recurse();
    }
    if (tankRotation === 180) {
      const values = new Array(2_000_000).fill(1);
      if (values.length) moveRight();
    }
    if (typeof fetch === 'undefined' && typeof postMessage === 'undefined' &&
        typeof document === 'undefined' && typeof process === 'undefined' &&
        allBullets[0].x === 2.5 && Object.isFrozen(allBullets[0])) {
      shoot();
      moveLeft();
    }
  `);
  const workerReadyMs = performance.now() - startedAt;
  try {
    const snapshot = makeSnapshot();
    assert((await runner.runTick(snapshot))?.action === 'shoot', 'Expected the first valid action');
    await expectError(runner.runTick({ ...snapshot, tankHealth: 2 }), 'EXECUTION_TIMEOUT');
    await expectError(runner.runTick({ ...snapshot, tankRotation: 90 }), 'RUNTIME_ERROR');
    await expectError(runner.runTick({ ...snapshot, tankRotation: 180 }), 'RUNTIME_ERROR');
    assert((await runner.runTick(snapshot))?.action === 'shoot', 'Expected a later tick to work after resource errors');
    return { ...runner.timings, workerReadyMs };
  } finally {
    await Promise.all([runner.dispose(), runner.dispose()]);
    await expectError(runner.runTick(makeSnapshot()), 'DISPOSED');
  }
}

async function checkBatchResponsiveness() {
  const tanks = [
    { tankId: 37, source: 'while (true) {}' },
    { tankId: 9, source: 'shoot(); moveRight(); return;' },
    { tankId: 41, source: 'return {' },
  ];
  const states = tanks.map(tank => ({ ...makeSnapshot(), tankId: tank.tankId }));
  const runner = await createTankScriptBattleRunner(tanks);
  let heartbeats = 0;
  const interval = setInterval(() => heartbeats++, 5);
  try {
    const { results, executionMs } = await runner.runTick(states);
    assert(heartbeats > 0, 'Main thread heartbeat stopped during QuickJS execution');
    assert(results[0].error?.code === 'EXECUTION_TIMEOUT', 'Expected a per-tank timeout');
    assert(results[1].command?.action === 'shoot', 'Expected a healthy tank to finish the same batch');
    assert(results[2].error?.code === 'COMPILE_ERROR', 'Expected the isolated compile error');
    return { heartbeats, executionMs: Number(executionMs.toFixed(2)) };
  } finally {
    clearInterval(interval);
    await runner.dispose();
  }
}

async function checkWorkerSupervisor() {
  const RealWorker = globalThis.Worker;
  let terminations = 0;
  let mode = 'invalid';
  const states = [{ ...makeSnapshot(), tankId: 37 }];
  const tanks = [{ tankId: 37, source: 'shoot();' }];

  // Inject transport faults while keeping the actual worker lifecycle.
  globalThis.Worker = class extends RealWorker {
    postMessage(message) {
      if (message.type !== 'runBatch') {
        super.postMessage(message);
      } else if (mode === 'invalid') {
        const { id } = message;
        const result = { entries: [{ tankId: 37, action: 'teleport' }], executionMs: 0, workerMs: 0 };
        queueMicrotask(() => this.onmessage({ data: { id, ok: true, result } }));
      } else if (mode === 'crash') {
        queueMicrotask(() => this.dispatchEvent(new ErrorEvent('error', { cancelable: true })));
      }
    }

    terminate() {
      terminations++;
      super.terminate();
    }
  };

  try {
    const invalid = await createTankScriptBattleRunner(tanks);
    await expectError(invalid.runTick(states), 'INVALID_COMMAND');
    await invalid.dispose();

    mode = 'crash';
    const failed = await createTankScriptBattleRunner(tanks);
    await expectError(failed.runTick(states), 'WORKER_ERROR');
    await expectError(failed.runTick(states), 'DISPOSED');

    mode = 'silent';
    const silent = await createTankScriptBattleRunner(tanks);
    const startedAt = performance.now();
    await expectError(silent.runTick(states), 'WORKER_TIMEOUT');
    const timeoutMs = performance.now() - startedAt;
    await silent.dispose();

    assert(terminations === 3, 'Each failed worker should be terminated once');
    return { terminations, timeoutMs: Number(timeoutMs.toFixed(2)) };
  } finally {
    globalThis.Worker = RealWorker;
  }
}

async function checkRepeatedBattles() {
  const RealWorker = globalThis.Worker;
  let created = 0;
  let terminated = 0;
  let deliverStaleReply;
  const tanks = [
    { tankId: 37, source: 'while (true) {}' },
    { tankId: 9, source: 'if (!globalThis.ran) shoot(); globalThis.ran = true;' },
  ];
  const states = tanks.map(tank => ({ ...makeSnapshot(), tankId: tank.tankId }));

  globalThis.Worker = class extends RealWorker {
    constructor(...args) {
      super(...args);
      this.sequence = ++created;
    }

    postMessage(message) {
      if (this.sequence === 1 && message.type === 'runBatch') {
        const handleReply = this.onmessage;
        const result = { entries: [{ tankId: 9, action: 'moveLeft' }], executionMs: 0, workerMs: 0 };
        deliverStaleReply = () => handleReply({ data: { id: message.id, ok: true, result } });
      }
      super.postMessage(message);
    }

    terminate() {
      terminated++;
      super.terminate();
    }
  };

  try {
    const cancelled = await createTankScriptBattleRunner(tanks);
    const pending = expectError(cancelled.runTick(states), 'DISPOSED');
    await new Promise(resolve => setTimeout(resolve, 10));
    const cancelStartedAt = performance.now();
    await Promise.all([cancelled.dispose(), pending]);
    const cancellationMs = performance.now() - cancelStartedAt;

    const heapSamples = [];
    const disposalSamples = [];
    for (let i = 0; i < 5; i++) {
      const fresh = await createTankScriptBattleRunner(tanks);
      try {
        const current = fresh.runTick([states[1]]);
        if (i === 0) deliverStaleReply();
        const { results } = await current;
        assert(results[0].command?.action === 'shoot', 'Fresh battle received stale state or a stale reply');
        heapSamples.push(await fresh.getHeapUsageBytes());
      } finally {
        const startedAt = performance.now();
        const disposal = await fresh.dispose();
        assert(disposal?.disposedCount === tanks.length, 'Normal shutdown did not acknowledge all runtimes');
        disposalSamples.push(Number((performance.now() - startedAt).toFixed(2)));
      }
    }
    assert(created === 6 && terminated === created, 'A battle worker was left running');
    return { created, terminated, cancellationMs: Number(cancellationMs.toFixed(2)), heapSamples, disposalSamples };
  } finally {
    globalThis.Worker = RealWorker;
  }
}

const output = document.querySelector('#results');
try {
  const singleTank = await checkRealWorker();
  await expectError(createTankScriptWorkerRunner('return {'), 'COMPILE_ERROR');
  const responsiveness = await checkBatchResponsiveness();
  const supervisor = await checkWorkerSupervisor();
  const repeatedBattles = await checkRepeatedBattles();
  const results = { status: 'RUNNING', singleTank, responsiveness, supervisor, repeatedBattles, scenarios: [] };
  const show = () => { output.textContent = JSON.stringify(results, null, 2); };
  show();
  await benchmarkBattles(scenario => {
    results.scenarios.push(scenario);
    show();
  });
  results.status = 'PASS';
  show();
} catch (error) {
  output.textContent = `FAIL: ${error.stack ?? error.message}`;
}
