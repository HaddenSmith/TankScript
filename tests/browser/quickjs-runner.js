import { createTankScriptWorkerRunner } from '../../src/game/tank-script/tankScriptWorkerRunner.js';
import { TANK_SCRIPT_ACTIONS } from '../../src/game/tank-script/tankScriptRunnerProtocol.js';
import { createTankScriptApi } from '../../src/game/tank-script/tankScriptApi.js';
import { executeTankScript } from '../../src/game/tank-script/tankScriptExecutor.js';
import { builtInTanks } from '../../src/game/builtInTanks/builtInTanks.js';

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

async function checkCancellation() {
  const runner = await createTankScriptWorkerRunner('shoot();');
  const result = expectError(runner.runTick(makeSnapshot()), 'DISPOSED');
  await Promise.all([runner.dispose(), result]);
  await runner.dispose();
}

async function checkWorkerSupervisor() {
  const RealWorker = globalThis.Worker;
  let terminations = 0;
  let invalidReply = true;

  // Use real workers but substitute the reply for the request under test.
  globalThis.Worker = class extends RealWorker {
    postMessage(message) {
      if (message.type !== 'runTick') {
        super.postMessage(message);
      } else if (invalidReply) {
        const { id } = message;
        queueMicrotask(() => this.onmessage({ data: { id, ok: true, result: 'teleport' } }));
      }
    }

    terminate() {
      terminations += 1;
      super.terminate();
    }
  };

  try {
    const invalid = await createTankScriptWorkerRunner('shoot();');
    await expectError(invalid.runTick(makeSnapshot()), 'INVALID_COMMAND');
    await invalid.dispose();

    invalidReply = false;
    const silent = await createTankScriptWorkerRunner('shoot();');
    const startedAt = performance.now();
    await expectError(silent.runTick(makeSnapshot()), 'WORKER_TIMEOUT');
    await silent.dispose();

    assert(terminations === 2, 'Each failed worker should have been terminated once');
    return performance.now() - startedAt;
  } finally {
    globalThis.Worker = RealWorker;
  }
}

function median(samples) {
  return Number(samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)].toFixed(3));
}

async function measureOfficialTanks() {
  const measurements = [];
  for (const [index, tank] of builtInTanks.entries()) {
    const snapshot = makeSnapshot(allTanks[index]);
    const runner = await createTankScriptWorkerRunner(tank.code);
    try {
      for (let i = 0; i < 5; i++) await runner.runTick(snapshot);
      const workerSamples = [];
      const existingSamples = [];
      for (let i = 0; i < 30; i++) {
        const workerStart = performance.now();
        const command = await runner.runTick(snapshot);
        workerSamples.push(performance.now() - workerStart);
        assert(TANK_SCRIPT_ACTIONS.includes(command?.action), `${tank.name} returned an invalid action`);

        const existingStart = performance.now();
        const api = createTankScriptApi();
        executeTankScript(tank.code, api, snapshot);
        existingSamples.push(performance.now() - existingStart);
      }
      const heapBytes = await runner.getHeapUsageBytes();
      assert(Number.isFinite(heapBytes) && heapBytes > 0, 'Expected a QuickJS heap reading');
      measurements.push({
        tank: tank.name,
        ...runner.timings,
        medianWarmWorkerRoundTripMs: median(workerSamples),
        medianExistingExecutorMs: median(existingSamples),
        maxWarmWorkerRoundTripMs: Number(Math.max(...workerSamples).toFixed(3)),
        heapBytes,
      });
    } finally {
      await runner.dispose();
    }
  }
  return measurements;
}

const output = document.querySelector('#results');
try {
  const coldStartup = await checkRealWorker();
  await checkCancellation();
  await expectError(createTankScriptWorkerRunner('return {'), 'COMPILE_ERROR');
  const supervisorTimeoutMs = await checkWorkerSupervisor();
  const officialTanks = await measureOfficialTanks();
  output.textContent = JSON.stringify({
    status: 'PASS',
    coldStartup,
    supervisorTimeoutMs,
    officialTanks,
  }, null, 2);
} catch (error) {
  output.textContent = `FAIL: ${error.stack ?? error.message}`;
}
