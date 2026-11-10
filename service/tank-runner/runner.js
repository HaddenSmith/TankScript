import { getQuickJS } from 'quickjs-emscripten';
import { createQuickJSTankRuntime } from '../../src/game/tank-script/quickjsTankRuntime.js';
import {
  TANK_SCRIPT_PARTICIPANT_ERRORS,
  TankScriptRunnerError,
} from '../../src/game/tank-script/tankScriptRunnerProtocol.js';
import {
  MAX_REQUEST_BYTES,
  MAX_REPLY_BYTES,
  MAX_TICKS,
  encodeMessage,
  hasKeys,
  readMessages,
  runnerError,
  validateParticipants,
  validateSnapshots,
  validId,
} from './protocol.js';
import { containerUsage, requireContainerIsolation } from './isolation.js';

const runtimes = new Map();
const container = process.argv[2] === '--container';
let ids;
let nextId = 1;
let ticks = 0;

function participantCode(error) {
  if (error instanceof TankScriptRunnerError && TANK_SCRIPT_PARTICIPANT_ERRORS.includes(error.code)) {
    return error.code;
  }
  throw error;
}

async function initialize(tanks) {
  ids = validateParticipants(tanks);
  const started = performance.now();
  const quickJS = await getQuickJS();
  const wasmInitializationMs = performance.now() - started;
  const entries = [];

  for (const { tankId, source } of tanks) {
    try {
      const runtime = await createQuickJSTankRuntime(source, quickJS);
      runtimes.set(tankId, { runtime });
      entries.push({ tankId, timings: runtime.timings });
    } catch (error) {
      const code = participantCode(error);
      runtimes.set(tankId, { code });
      entries.push({ tankId, code });
    }
  }
  return { wasmInitializationMs, entries };
}

function runTick(states) {
  if (ticks >= MAX_TICKS) throw runnerError('INVALID_REQUEST');
  const snapshots = validateSnapshots(states, ids);
  ticks++;
  const started = performance.now();
  const entries = snapshots.map(({ tankId, snapshotJSON }) => {
    const { runtime, code } = runtimes.get(tankId);
    if (code) return { tankId, code };

    try {
      return { tankId, action: runtime.runTick(snapshotJSON) ?? null };
    } catch (error) {
      return { tankId, code: participantCode(error) };
    }
  });
  return { entries, executionMs: performance.now() - started };
}

function disposeRuntimes() {
  let failure;
  for (const { runtime } of runtimes.values()) {
    try {
      runtime?.dispose();
    } catch (error) {
      failure ??= error;
    }
  }
  runtimes.clear();
  if (failure) throw failure;
}

function stats() {
  const { user, system } = process.cpuUsage();
  return {
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    cpuMs: (user + system) / 1_000,
    container: container ? containerUsage() : null,
  };
}

async function send(message) {
  const frame = encodeMessage(message, MAX_REPLY_BYTES);
  await new Promise((resolve, reject) => {
    process.stdout.write(frame, error => error ? reject(error) : resolve());
  });
}

try {
  if (container) requireContainerIsolation();
  for await (const request of readMessages(process.stdin, MAX_REQUEST_BYTES)) {
    const id = request?.id;
    if (!validId(id) || id !== nextId++) throw runnerError('PROTOCOL_ERROR');

    try {
      let result;
      const { type } = request;
      if (type === 'initialize' && !ids && hasKeys(request, ['id', 'type', 'tanks'])) {
        result = await initialize(request.tanks);
      } else if (type === 'runTick' && ids && hasKeys(request, ['id', 'type', 'states'])) {
        result = runTick(request.states);
      } else if (type === 'stats' && ids && hasKeys(request, ['id', 'type'])) {
        result = stats();
      } else if (type === 'dispose' && ids && hasKeys(request, ['id', 'type'])) {
        disposeRuntimes();
        await send({ id, ok: true, result: null });
        break;
      } else {
        throw runnerError('INVALID_REQUEST');
      }

      await send({ id, ok: true, result });
    } catch (error) {
      const code = ['INVALID_REQUEST', 'INVALID_SNAPSHOT', 'INVALID_SOURCE'].includes(error.code)
        ? 'INVALID_REQUEST'
        : 'RUNNER_ERROR';
      await send({ id, ok: false, code });
      process.exitCode = 1;
      break;
    }
  }
} catch {
  process.exitCode = 1;
} finally {
  try {
    disposeRuntimes();
  } catch {
    process.exitCode = 1;
  }
}
