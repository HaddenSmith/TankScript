import { getQuickJS } from 'quickjs-emscripten';
import { createQuickJSTankRuntime } from './quickjsTankRuntime.js';
import { TANK_SCRIPT_PARTICIPANT_ERRORS, TankScriptRunnerError } from './tankScriptRunnerProtocol.js';

let participants;

function participantError(error) {
  if (error instanceof TankScriptRunnerError &&
      TANK_SCRIPT_PARTICIPANT_ERRORS.includes(error.code)) {
    return error.code;
  }
  throw error;
}

async function initialize(tanks) {
  participants = new Map();
  const startedAt = performance.now();
  const quickJS = await getQuickJS();
  const wasmInitializationMs = performance.now() - startedAt;

  const entries = [];
  for (const { tankId, source } of tanks) {
    try {
      const runtime = await createQuickJSTankRuntime(source, quickJS);
      participants.set(tankId, { runtime });
      entries.push({ tankId, timings: runtime.timings });
    } catch (error) {
      const code = participantError(error);
      participants.set(tankId, { code });
      entries.push({ tankId, code });
    }
  }
  return { wasmInitializationMs, entries };
}

function runBatch(snapshots) {
  const startedAt = performance.now();
  let executionMs = 0;
  const entries = snapshots.map(({ tankId, snapshotJSON }) => {
    const { runtime, code } = participants.get(tankId);
    if (code) return { tankId, code };

    const executionStartedAt = performance.now();
    try {
      return { tankId, action: runtime.runTick(snapshotJSON) };
    } catch (error) {
      return { tankId, code: participantError(error) };
    } finally {
      executionMs += performance.now() - executionStartedAt;
    }
  });
  return { entries, executionMs, workerMs: performance.now() - startedAt };
}

function heapUsage() {
  let bytes = 0;
  for (const { runtime } of participants.values()) {
    if (runtime) bytes += runtime.getHeapUsageBytes();
  }
  return bytes;
}

function dispose() {
  const startedAt = performance.now();
  let disposedCount = 0;
  for (const { runtime } of participants.values()) {
    if (!runtime) continue;
    runtime.dispose();
    disposedCount++;
  }
  participants.clear();
  return { disposedCount, cleanupMs: performance.now() - startedAt };
}

self.onmessage = async ({ data }) => {
  const { id, type, tanks, snapshots } = data;
  try {
    let result;
    if (type === 'initialize' && !participants) {
      result = await initialize(tanks);
    } else if (type === 'runBatch' && participants) {
      result = runBatch(snapshots);
    } else if (type === 'heapUsage' && participants) {
      result = heapUsage();
    } else if (type === 'dispose' && participants) {
      result = dispose();
    } else {
      throw new TankScriptRunnerError('WORKER_ERROR');
    }
    self.postMessage({ id, ok: true, result });
  } catch {
    // A Wasm or worker failure can affect every runtime in this worker.
    self.postMessage({ id, ok: false });
  }
};
