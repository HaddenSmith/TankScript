import {
  TANK_SCRIPT_LIMITS,
  TANK_SCRIPT_PARTICIPANT_ERRORS,
  TankScriptRunnerError,
  serializeTankSnapshot,
  tankScriptCommand,
  validateTankSource,
} from './tankScriptRunnerProtocol.js';

function createWorkerSession(signal) {
  if (signal?.aborted) throw new TankScriptRunnerError('DISPOSED');

  let worker;
  try {
    worker = new Worker(new URL('./quickjsTankWorker.js', import.meta.url), { type: 'module' });
  } catch {
    throw new TankScriptRunnerError('WORKER_ERROR');
  }

  let nextId = 0;
  let pending;
  let disposal;
  let closed = false;

  function finishRequest() {
    const request = pending;
    pending = undefined;
    clearTimeout(request?.timer);
    return request;
  }

  function close(code) {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', abort);
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    finishRequest()?.reject(new TankScriptRunnerError(code));
  }

  function abort() {
    close('DISPOSED');
  }
  signal?.addEventListener('abort', abort, { once: true });

  worker.onerror = event => {
    event.preventDefault();
    close('WORKER_ERROR');
  };
  worker.onmessageerror = () => close('WORKER_ERROR');
  worker.onmessage = ({ data }) => {
    if (!pending || data?.id !== pending.id) return;
    if (data.ok === true && Object.hasOwn(data, 'result')) {
      finishRequest().resolve(data.result);
    } else {
      close('WORKER_ERROR');
    }
  };

  function request(type, fields = {}, timeoutMs = TANK_SCRIPT_LIMITS.workerRequestMs) {
    if (closed) return Promise.reject(new TankScriptRunnerError('DISPOSED'));
    if (pending) return Promise.reject(new TankScriptRunnerError('BUSY'));

    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => close('WORKER_TIMEOUT'), timeoutMs);
      pending = { id, resolve, reject, timer };
      try {
        worker.postMessage({ id, type, ...fields });
      } catch {
        close('WORKER_ERROR');
      }
    });
  }

  async function disposeWorker() {
    if (closed) return;
    try {
      // Terminate immediately when a batch is in flight.
      if (!pending) return await request('dispose');
    } finally {
      close('DISPOSED');
    }
  }

  return {
    request,
    close,
    assertReady() {
      if (closed || disposal) throw new TankScriptRunnerError('DISPOSED');
      if (pending) throw new TankScriptRunnerError('BUSY');
    },
    dispose() {
      disposal ??= disposeWorker();
      return disposal;
    },
  };
}

function participantResult(code, tankId) {
  if (!TANK_SCRIPT_PARTICIPANT_ERRORS.includes(code)) {
    throw new TankScriptRunnerError('WORKER_ERROR');
  }
  return { tankId, error: { code, message: new TankScriptRunnerError(code).message } };
}

function readEntries(entries, expected, decode) {
  if (!Array.isArray(entries) || entries.length !== expected.length) {
    throw new TankScriptRunnerError('WORKER_ERROR');
  }
  return expected.map(({ tankId }, index) => {
    const entry = entries[index];
    if (entry?.tankId !== tankId) throw new TankScriptRunnerError('WORKER_ERROR');
    return Object.hasOwn(entry, 'code') ? participantResult(entry.code, tankId) : decode(entry);
  });
}

async function startRunner(tanks, batchTimeoutMs, signal) {
  const session = createWorkerSession(signal);
  try {
    const { entries, wasmInitializationMs } = await session.request(
      'initialize', { tanks }, TANK_SCRIPT_LIMITS.workerStartupMs,
    );
    const initialization = readEntries(entries, tanks, ({ tankId, timings }) => ({ tankId, timings }));

    return {
      ...session,
      initialization,
      wasmInitializationMs,
      async runBatch(snapshots) {
        const result = await session.request('runBatch', { snapshots }, batchTimeoutMs);
        try {
          const { entries, executionMs, workerMs } = result;
          const results = readEntries(entries, snapshots, entry => {
            if (!Object.hasOwn(entry, 'action')) throw new TankScriptRunnerError('WORKER_ERROR');
            return { tankId: entry.tankId, command: tankScriptCommand(entry.action) };
          });
          return { results, executionMs, workerMs };
        } catch (error) {
          const code = error instanceof TankScriptRunnerError ? error.code : 'WORKER_ERROR';
          session.close(code);
          throw new TankScriptRunnerError(code);
        }
      },
      getHeapUsageBytes() {
        return session.request('heapUsage');
      },
    };
  } catch (error) {
    session.close('WORKER_ERROR');
    throw error;
  }
}

export async function createTankScriptWorkerRunner(source, { signal } = {}) {
  validateTankSource(source);
  const runner = await startRunner([{ tankId: 0, source }], TANK_SCRIPT_LIMITS.workerRequestMs, signal);
  const [tank] = runner.initialization;
  if (tank.error) {
    await runner.dispose();
    throw new TankScriptRunnerError(tank.error.code);
  }
  return {
    timings: {
      ...tank.timings,
      initializationMs: runner.wasmInitializationMs + tank.timings.initializationMs,
    },
    async runTick(state) {
      runner.assertReady();
      const { results: [result] } = await runner.runBatch([
        { tankId: 0, snapshotJSON: serializeTankSnapshot(state) },
      ]);
      if (result.error) throw new TankScriptRunnerError(result.error.code);
      return result.command;
    },
    getHeapUsageBytes: runner.getHeapUsageBytes,
    dispose: runner.dispose,
  };
}

// The caller supplies the pre-tick snapshots. Dead tanks may be omitted or included.
export async function createTankScriptBattleRunner(participants) {
  if (!Array.isArray(participants) || participants.length === 0 ||
      participants.length > TANK_SCRIPT_LIMITS.participants) {
    throw new TankScriptRunnerError('INVALID_BATCH');
  }
  const ids = new Set();
  const tanks = [];
  for (const tank of participants) {
    const { tankId, source } = tank ?? {};
    if (!Number.isSafeInteger(tankId) || ids.has(tankId)) {
      throw new TankScriptRunnerError('INVALID_BATCH');
    }
    validateTankSource(source);
    ids.add(tankId);
    tanks.push({ tankId, source });
  }

  const runner = await startRunner(tanks, TANK_SCRIPT_LIMITS.workerBatchMs);
  return {
    initialization: runner.initialization,
    wasmInitializationMs: runner.wasmInitializationMs,
    async runTick(states) {
      runner.assertReady();
      if (!Array.isArray(states) || states.length > ids.size) {
        throw new TankScriptRunnerError('INVALID_BATCH');
      }

      const seen = new Set();
      const snapshots = [];
      for (const state of states) {
        const tankId = state?.tankId;
        if (!ids.has(tankId) || seen.has(tankId) || !Number.isFinite(state.tankHealth)) {
          throw new TankScriptRunnerError('INVALID_BATCH');
        }
        seen.add(tankId);
        if (state.tankHealth > 0) snapshots.push({ tankId, snapshotJSON: serializeTankSnapshot(state) });
      }
      return runner.runBatch(snapshots);
    },
    getHeapUsageBytes: runner.getHeapUsageBytes,
    dispose: runner.dispose,
  };
}
