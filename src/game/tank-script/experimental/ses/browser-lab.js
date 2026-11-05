import { createQuickJSTankRunner } from '../../quickjsTankRunner.js';
import { createTankScriptApi } from '../../tankScriptApi.js';
import { executeTankScript } from '../../tankScriptExecutor.js';
import { BattleEngine } from '../../../engine/battleEngine.js';
import { Tank } from '../../../engine/tank.js';
import easyTank from '../../../builtInTanks/easyTank.js';
import mediumTank from '../../../builtInTanks/mediumTank.js';
import hardTank from '../../../builtInTanks/hardTank.js';
import expertTank from '../../../builtInTanks/expertTank.js';
import overkillTank from '../../../builtInTanks/overkillTank.js';
import { createSESTankRunner, SESTankExecutionError } from './sesTankRunner.js';

const tanks = [easyTank, mediumTank, hardTank, expertTank, overkillTank];
const arenaWidth = 24;
const arenaHeight = 24;
const output = document.querySelector('#results');
const runButton = document.querySelector('#run-lab');
const results = [];

function log(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  results.push(text);
  output.textContent = results.join('\n');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(name, run) {
  try {
    await run();
    log(`PASS ${name}`);
  } catch (error) {
    log(`FAIL ${name}: ${error.stack || error.message || String(error)}`);
    throw error;
  }
}

function stateFor(tankId = 1, overrides = {}) {
  return {
    tankId,
    tankPosition: { x: 3, y: 4 },
    tankRotation: 0,
    tankHealth: 2,
    allTanks: [
      { id: 1, name: 'Self', x: 3, y: 4, rotation: 0, health: 2 },
      { id: 2, name: 'Opponent', x: 8, y: 4, rotation: 180, health: 3 },
    ],
    allBullets: [],
    arenaWidth: 12,
    arenaHeight: 12,
    ...overrides,
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

function actionForExisting(code, state) {
  const api = createTankScriptApi();
  executeTankScript(code, api, state);
  return api.getSubmittedCommand();
}

function createControlledStates() {
  const engine = new BattleEngine(arenaWidth, arenaHeight);
  const starts = [[1, 1], [11, 1], [22, 1], [1, 22], [11, 22]];
  tanks.forEach((definition, index) => {
    const [x, y] = starts[index];
    engine.addTank(new Tank(
      index + 1,
      definition.name,
      x,
      y,
      definition.code,
      3,
      definition.color,
    ));
  });

  const allTanks = engine.arena.tanks.map(tank => ({
    id: tank.id,
    name: tank.name,
    x: tank.x,
    y: tank.y,
    rotation: tank.rotation,
    health: tank.health,
  }));
  const allBullets = [
    { id: 1, ownerId: 2, x: 7.5, y: 4, rotation: 180 },
    { id: 2, ownerId: 4, x: 9, y: 5.5, rotation: 90 },
  ];

  return engine.arena.tanks.map(tank => deepFreeze({
    tankId: tank.id,
    tankPosition: { x: tank.x, y: tank.y },
    tankRotation: tank.rotation,
    tankHealth: tank.health,
    allTanks,
    allBullets,
    arenaWidth,
    arenaHeight,
  }));
}

async function securityChecks() {
  const runners = [];
  const create = async (code, options) => {
    const runner = await createSESTankRunner(code, options);
    runners.push(runner);
    return runner;
  };

  try {
    await check('blocks browser, network, storage, worker, and app globals', async () => {
      const runner = await create(`
        const forbidden = [
          'window', 'document', 'localStorage', 'sessionStorage', 'indexedDB',
          'fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource',
          'navigator', 'location', 'process', 'require', 'React', 'BattleEngine',
          'self', 'postMessage', 'importScripts'
        ];
        if (forbidden.some(name => typeof globalThis[name] !== 'undefined')) {
          throw new Error('A host capability is visible');
        }
        shoot();
      `);
      assert((await runner.runTick(stateFor())).action === 'shoot', 'expected a command');
    });

    await check('isolates and freezes each serialized state snapshot', async () => {
      const sourceState = stateFor();
      const runner = await create(`
        let blocked = 0;
        try { tankPosition.x = 99; } catch { blocked += 1; }
        try { allTanks[1].x = 99; } catch { blocked += 1; }
        try { allBullets.push({ id: 3 }); } catch { blocked += 1; }
        if (blocked !== 3 || tankPosition.x !== 3 ||
            allTanks[1].x !== 8 || allBullets.length !== 0) {
          throw new Error('Input snapshot was mutable');
        }
        shoot();
      `);
      assert((await runner.runTick(sourceState)).action === 'shoot', 'expected a command');
      assert(sourceState.tankPosition.x === 3, 'host state was mutated');
      assert(sourceState.allTanks[1].x === 8, 'host tank snapshot was mutated');
    });

    await check('prevents shared intrinsic prototype modification', async () => {
      const runner = await create(`
        let objectMutationBlocked = false;
        let arrayMutationBlocked = false;
        try { Object.prototype.tankEscape = true; } catch { objectMutationBlocked = true; }
        try { Array.prototype.push = () => {}; } catch { arrayMutationBlocked = true; }
        if (!objectMutationBlocked || !arrayMutationBlocked ||
            Object.prototype.tankEscape !== undefined ||
            !Object.isFrozen(Object.prototype) ||
            !Object.isFrozen(Array.prototype)) {
          throw new Error('A shared intrinsic was mutable');
        }
        shoot();
      `);
      assert((await runner.runTick(stateFor())).action === 'shoot', 'expected a command');
    });

    await check('confines globalThis, eval, Function, and constructors', async () => {
      const runner = await create(`
        let dynamicChecksPassed = true;
        try {
          const dynamicGlobal = Function('return globalThis')();
          dynamicChecksPassed = dynamicChecksPassed &&
            dynamicGlobal === globalThis &&
            typeof dynamicGlobal.fetch === 'undefined' &&
            typeof dynamicGlobal.document === 'undefined';
        } catch {}
        try {
          const constructorGlobal = globalThis.constructor.constructor('return globalThis')();
          dynamicChecksPassed = dynamicChecksPassed &&
            constructorGlobal === globalThis &&
            typeof constructorGlobal.fetch === 'undefined';
        } catch {}
        try {
          const evaluatedGlobal = eval('globalThis');
          dynamicChecksPassed = dynamicChecksPassed &&
            evaluatedGlobal === globalThis &&
            typeof evaluatedGlobal.React === 'undefined';
        } catch {}
        if (!dynamicChecksPassed) throw new Error('Dynamic code escaped the compartment');
        shoot();
      `);
      assert((await runner.runTick(stateFor())).action === 'shoot', 'expected a command');
    });

    await check('does not provide an unrestricted module loader', async () => {
      try {
        await createSESTankRunner("import('data:text/javascript,export default 1'); shoot();");
        throw new Error('Dynamic import unexpectedly compiled');
      } catch (error) {
        assert(error instanceof SESTankExecutionError, 'module rejection was not typed');
        assert(error.code === 'SES_IMPORT_REJECTED', `unexpected module error code ${error.code}`);
      }
    });

    await check('records only the first action and preserves early returns', async () => {
      const runner = await create('moveLeft(); shoot(); return; moveRight();');
      assert((await runner.runTick(stateFor())).action === 'moveLeft', 'wrong first action');
      const earlyReturnRunner = await create('moveUp(); return; moveDown();');
      assert((await earlyReturnRunner.runTick(stateFor())).action === 'moveUp', 'early return lost action');
    });

    await check('resets local variables and preserves per-tank compartment state', async () => {
      const first = await create(`
        let localCounter = 0;
        localCounter += 1;
        if (localCounter === 1) moveRight();
        else moveLeft();
      `);
      assert((await first.runTick(stateFor())).action === 'moveRight', 'first local counter was wrong');
      assert((await first.runTick(stateFor())).action === 'moveRight', 'local counter persisted');

      const privateState = await create("globalThis.privateToken = 'tank-one'; shoot();");
      const otherTank = await create(`
        if (typeof globalThis.privateToken !== 'undefined') {
          throw new Error('another tank global leaked');
        }
        moveDown();
      `);
      await privateState.runTick(stateFor());
      assert((await otherTank.runTick(stateFor(2))).action === 'moveDown', 'tank workers shared a global');
    });

    await check('rejects invalid source and isolates repeated runtime failures', async () => {
      try {
        await createSESTankRunner('if (');
        throw new Error('invalid source unexpectedly compiled');
      } catch (error) {
        assert(error instanceof SESTankExecutionError, 'compile failure was not typed');
        assert(error.code === 'INVALID_JAVASCRIPT', `unexpected compile code ${error.code}`);
      }

      const runner = await create(`
        if (tankHealth === 0) throw new Error('expected failure');
        shoot();
      `);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await runner.runTick(stateFor(1, { tankHealth: 0 })).then(
          () => { throw new Error('runtime error unexpectedly succeeded'); },
          error => assert(error.code === 'RUNTIME_ERROR', `unexpected runtime code ${error.code}`),
        );
      }
      assert((await runner.runTick(stateFor(1, { tankHealth: 1 }))).action === 'shoot',
        'worker did not recover after repeated exceptions');
      assert(runner.getMetrics().workerStarts === 1, 'runtime failures restarted the worker');
    });

    await check('contains recursion failure without losing later ticks', async () => {
      const runner = await create(`
        if (tankHealth === 0) {
          function recurse() { recurse(); }
          recurse();
        }
        shoot();
      `);
      await runner.runTick(stateFor(1, { tankHealth: 0 })).then(
        () => { throw new Error('recursive script unexpectedly succeeded'); },
        error => assert(error.code === 'RUNTIME_ERROR', `unexpected recursion code ${error.code}`),
      );
      assert((await runner.runTick(stateFor(1, { tankHealth: 1 }))).action === 'shoot',
        'worker did not recover after recursion error');
    });

    await check('terminates a nonresponsive worker and lets another tank continue', async () => {
      const hanging = await create(`
        if (tankHealth === 0) while (true) {}
        shoot();
      `, { executionTimeMs: 100 });
      const healthy = await create('moveRight();', { executionTimeMs: 100 });
      let heartbeats = 0;
      const heartbeat = setInterval(() => { heartbeats += 1; }, 10);
      const timeoutStartedAt = performance.now();
      let healthyResult;
      let timeoutResult;
      try {
        [healthyResult, timeoutResult] = await Promise.all([
          healthy.runTick(stateFor()).then(command => ({ command }), error => ({ error })),
          hanging.runTick(stateFor(1, { tankHealth: 0 })).then(
            () => ({ success: true }),
            error => ({ error }),
          ),
        ]);
      } finally {
        clearInterval(heartbeat);
      }

      assert(healthyResult.command?.action === 'moveRight', 'other tank did not continue');
      assert(timeoutResult.error?.code === 'EXECUTION_TIMEOUT', 'hung worker did not time out');
      assert(heartbeats > 0, 'main thread did not respond during worker execution');
      assert(hanging.getMetrics().workerTerminations === 1, 'timed-out worker was not terminated');
      log({
        hungWorkerTimeoutElapsedMs: Number((performance.now() - timeoutStartedAt).toFixed(2)),
        mainThreadHeartbeatCount: heartbeats,
        workersTerminated: hanging.getMetrics().workerTerminations,
      });
      assert((await hanging.runTick(stateFor(1, { tankHealth: 1 }))).action === 'shoot',
        'timed-out runner did not create a replacement worker');
      assert(hanging.getMetrics().workerStarts === 2, 'runner did not recover with a new worker');
    });

    await check('terminates a finite but excessive computation in its worker', async () => {
      const runner = await create(`
        if (tankHealth === 0) {
          let value = 0;
          for (let index = 0; index < 1e12; index += 1) {
            value = (value + Math.sqrt(index)) % 1000;
          }
        }
        shoot();
      `, { executionTimeMs: 100 });
      await runner.runTick(stateFor(1, { tankHealth: 0 })).then(
        () => { throw new Error('excessive computation unexpectedly completed'); },
        error => assert(error.code === 'EXECUTION_TIMEOUT', `unexpected timeout code ${error.code}`),
      );
      assert(runner.getMetrics().workerTerminations === 1, 'long-running worker was not terminated');
    });

    await check('allows a bounded 32 MiB allocation only inside a terminable worker', async () => {
      const runner = await create(`
        globalThis.memoryPressure = [];
        for (let index = 0; index < 512; index += 1) {
          memoryPressure.push(new Uint8Array(64 * 1024));
        }
        shoot();
      `, { executionTimeMs: 1_000 });
      assert((await runner.runTick(stateFor())).action === 'shoot', 'bounded allocation failed');
      runner.dispose();
    });
  } finally {
    for (const runner of runners) runner.dispose();
  }
}

async function compatibilityChecks() {
  const states = createControlledStates();
  const quickJSRunners = await Promise.all(tanks.map(tank => createQuickJSTankRunner(tank.code)));
  const sesRunners = await Promise.all(tanks.map(tank => createSESTankRunner(tank.code)));
  try {
    await check('returns the same command for deterministic code in all three executors', async () => {
      const code = 'moveLeft(); shoot();';
      const state = deepFreeze(stateFor());
      const productionCommand = actionForExisting(code, state);
      const quickJS = await createQuickJSTankRunner(code);
      const ses = await createSESTankRunner(code);
      try {
        const quickJSCommand = quickJS.runTick(state);
        const sesCommand = await ses.runTick(state);
        assert(productionCommand.action === 'moveLeft', 'production command was wrong');
        assert(quickJSCommand.action === productionCommand.action, 'QuickJS command differed');
        assert(sesCommand.action === productionCommand.action, 'SES command differed');
      } finally {
        quickJS.dispose();
        ses.dispose();
      }
    });

    const commands = [];
    for (let index = 0; index < tanks.length; index += 1) {
      const state = states[index];
      const production = actionForExisting(tanks[index].code, state);
      const quickJS = quickJSRunners[index].runTick(state);
      const ses = await sesRunners[index].runTick(state);
      const outcomes = [production?.action, quickJS?.action, ses?.action];
      assert(outcomes.every(action => typeof action === 'string'),
        `${tanks[index].name} did not submit an action in every executor`);
      commands.push({
        tank: tanks[index].name,
        difficulty: tanks[index].difficulty,
        production: outcomes[0],
        quickJS: outcomes[1],
        ses: outcomes[2],
        allEqual: outcomes.every(action => action === outcomes[0]),
      });
    }
    log({ officialTankCommandsOnIdenticalState: commands });
    log('Official-tank command differences may be caused by each executor\'s random-number stream.');
  } finally {
    for (const runner of quickJSRunners) runner.dispose();
    for (const runner of sesRunners) runner.dispose();
  }
}

function captureBattleTick(engine) {
  const allTanks = engine.arena.tanks.map(tank => ({
    id: tank.id,
    name: tank.name,
    x: tank.x,
    y: tank.y,
    rotation: tank.rotation,
    health: tank.health,
  }));
  const allBullets = engine.arena.bullets.map(bullet => ({
    id: bullet.id,
    ownerId: bullet.ownerId,
    x: bullet.x,
    y: bullet.y,
    rotation: bullet.rotation,
  }));
  return engine.arena.tanks.map(tank => deepFreeze({
    tankId: tank.id,
    tankPosition: { x: tank.x, y: tank.y },
    tankRotation: tank.rotation,
    tankHealth: tank.health,
    allTanks,
    allBullets,
    arenaWidth,
    arenaHeight,
  }));
}

function createBattleEngine() {
  const engine = new BattleEngine(arenaWidth, arenaHeight);
  const starts = [[1, 1], [11, 1], [22, 1], [1, 22], [11, 22]];
  tanks.forEach((definition, index) => {
    const [x, y] = starts[index];
    engine.addTank(new Tank(index + 1, definition.name, x, y, definition.code, 3, definition.color));
  });
  return engine;
}

function collectBattleSnapshots(tickCount) {
  const snapshots = [];
  while (snapshots.length < tickCount) {
    const engine = createBattleEngine();
    while (snapshots.length < tickCount) {
      snapshots.push(captureBattleTick(engine));
      if (engine.tick()) break;
    }
  }
  return snapshots;
}

function summarizeQuickJSMemory(runners) {
  return runners.reduce((total, runner) => {
    const usage = runner.getMemoryUsage();
    return total + (usage.memory_used_size || 0);
  }, 0);
}

function browserHeapUsed() {
  return performance.memory?.usedJSHeapSize ?? null;
}

function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function benchmark() {
  const initializationStart = performance.now();
  const quickJSRunners = await Promise.all(tanks.map(tank => createQuickJSTankRunner(tank.code)));
  const quickJSInitializationMs = performance.now() - initializationStart;

  const sesInitializationStart = performance.now();
  const sesRunners = await Promise.all(tanks.map(tank => createSESTankRunner(tank.code)));
  const sesInitializationMs = performance.now() - sesInitializationStart;
  const sesInitialization = sesRunners.map((runner, index) => ({
    tank: tanks[index].name,
    workerReadyMs: Number(runner.getMetrics().workerReadyMs.toFixed(2)),
    compilationMs: Number(runner.getMetrics().compilationMs.toFixed(2)),
  }));

  try {
    const warmup = collectBattleSnapshots(25);
    for (const tick of warmup) {
      for (let index = 0; index < tanks.length; index += 1) {
        actionForExisting(tanks[index].code, tick[index]);
        quickJSRunners[index].runTick(tick[index]);
        await sesRunners[index].runTick(tick[index]);
      }
    }

    log({
      initializationMs: {
        existingNewFunction: 0,
        quickJSInitializeAllFive: Number(quickJSInitializationMs.toFixed(2)),
        sesWorkersAndCompartmentsAllFive: Number(sesInitializationMs.toFixed(2)),
      },
      sesPerTankInitialization: sesInitialization,
      browserHeapBeforeBenchBytes: browserHeapUsed(),
      quickJSHeapBeforeBenchBytes: summarizeQuickJSMemory(quickJSRunners),
      sesWorkerHeapBytes: 'Not exposed by browser APIs',
    });

    for (const tickCount of [100, 500, 1_000]) {
      const states = collectBattleSnapshots(tickCount);
      const beforeHeap = browserHeapUsed();

      let productionCommands = 0;
      const productionStart = performance.now();
      for (const tick of states) {
        for (let index = 0; index < tanks.length; index += 1) {
          if (tick[index].tankHealth <= 0) continue;
          if (actionForExisting(tanks[index].code, tick[index])) productionCommands += 1;
        }
      }
      const productionCpuMs = performance.now() - productionStart;

      let quickJSCommands = 0;
      let quickJSCpuMs = 0;
      const quickJSWallStart = performance.now();
      for (let start = 0; start < states.length; start += 5) {
        const batchStart = performance.now();
        for (const tick of states.slice(start, start + 5)) {
          for (let index = 0; index < tanks.length; index += 1) {
            if (tick[index].tankHealth <= 0) continue;
            if (quickJSRunners[index].runTick(tick[index])) quickJSCommands += 1;
          }
        }
        quickJSCpuMs += performance.now() - batchStart;
        await yieldToBrowser();
      }
      const quickJSWallMs = performance.now() - quickJSWallStart;

      let sesCommands = 0;
      const metricsBefore = sesRunners.map(runner => runner.getMetrics());
      const sesWallStart = performance.now();
      for (const tick of states) {
        const commands = await Promise.all(sesRunners.map((runner, index) => (
          tick[index].tankHealth > 0 ? runner.runTick(tick[index]) : undefined
        )));
        sesCommands += commands.filter(Boolean).length;
      }
      const sesWallMs = performance.now() - sesWallStart;
      const metricsAfter = sesRunners.map(runner => runner.getMetrics());
      const serializationMs = metricsAfter.reduce(
        (total, metrics, index) => total + metrics.stateSerializationMs - metricsBefore[index].stateSerializationMs,
        0,
      );
      const roundTripMs = metricsAfter.reduce(
        (total, metrics, index) => total + metrics.roundTripMs - metricsBefore[index].roundTripMs,
        0,
      );
      const workerExecutionMs = metricsAfter.reduce(
        (total, metrics, index) => total + metrics.workerExecutionMs - metricsBefore[index].workerExecutionMs,
        0,
      );
      const sesTankTimings = metricsAfter.map((metrics, index) => ({
        tank: tanks[index].name,
        stateSerializationMs: Number((
          metrics.stateSerializationMs - metricsBefore[index].stateSerializationMs
        ).toFixed(2)),
        workerExecutionMs: Number((
          metrics.workerExecutionMs - metricsBefore[index].workerExecutionMs
        ).toFixed(2)),
        roundTripMs: Number((
          metrics.roundTripMs - metricsBefore[index].roundTripMs
        ).toFixed(2)),
      }));
      const quickJSHeapBytes = summarizeQuickJSMemory(quickJSRunners);

      log({
        ticks: tickCount,
        requestedTankRuns: tickCount * tanks.length,
        commandCounts: {
          existing: productionCommands,
          quickJS: quickJSCommands,
          ses: sesCommands,
        },
        existingNewFunctionCpuMs: Number(productionCpuMs.toFixed(2)),
        quickJSReusedRuntimeCpuMs: Number(quickJSCpuMs.toFixed(2)),
        quickJSChunkedBrowserWallMs: Number(quickJSWallMs.toFixed(2)),
        sesWorkerRoundTripWallMs: Number(sesWallMs.toFixed(2)),
        sesStateSerializationMs: Number(serializationMs.toFixed(2)),
        sesMeasuredWorkerExecutionMs: Number(workerExecutionMs.toFixed(2)),
        sesEstimatedMessageAndQueueMs: Number(Math.max(0, roundTripMs - workerExecutionMs).toFixed(2)),
        sesPerTankTimings: sesTankTimings,
        quickJSHeapBytes: quickJSHeapBytes,
        mainThreadHeapDeltaBytes:
          beforeHeap === null || browserHeapUsed() === null
            ? null
            : browserHeapUsed() - beforeHeap,
        sesWorkerHeapBytes: 'Not exposed by browser APIs',
      });
    }
  } finally {
    for (const runner of quickJSRunners) runner.dispose();
    for (const runner of sesRunners) runner.dispose();
  }
}

async function runLab() {
  runButton.disabled = true;
  results.length = 0;
  output.textContent = '';
  try {
    await securityChecks();
    await compatibilityChecks();
    await benchmark();
    log('All browser checks and benchmarks completed.');
  } catch (error) {
    log(`Lab stopped: ${error.message || String(error)}`);
  } finally {
    runButton.disabled = false;
  }
}

runButton.addEventListener('click', runLab);
