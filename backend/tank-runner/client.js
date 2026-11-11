import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  TANK_SCRIPT_LIMITS,
  TANK_SCRIPT_PARTICIPANT_ERRORS,
  TankScriptRunnerError,
  tankScriptCommand,
} from '../../shared/game/tank-script/tankScriptRunnerProtocol.js';
import {
  MAX_REQUEST_BYTES,
  MAX_REPLY_BYTES,
  encodeMessage,
  hasKeys,
  readMessages,
  runnerError,
  validateParticipants,
  validateSnapshots,
} from './protocol.js';
import { CONTAINER_MEMORY_BYTES, CONTAINER_PIDS } from './isolation.js';

const docker = promisify(execFile);
const dockerOptions = { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 };
const image = 'tankscript-runner:local';

export async function checkDockerTankRunner() {
  await docker('docker', ['image', 'inspect', '--format', '{{.Id}}', image], { ...dockerOptions, timeout: 2_000 });
}

export async function removeStaleTankRunners(now = Date.now()) {
  const options = { ...dockerOptions, timeout: 2_000, maxBuffer: 16 * 1024 };
  const { stdout } = await docker('docker', [
    'container', 'ls', '--all', '--no-trunc', '--filter', 'label=tankscript.runner=1',
    '--filter', 'status=created', '--format', '{{.ID}} {{.Names}}',
  ], options);
  for (const line of stdout.trim().split('\n').slice(-8)) {
    const [id, name] = line.trim().split(' ');
    if (!/^[a-f0-9]{64}$/.test(id) ||
        !/^tankscript-runner-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(name)) continue;
    try {
      const details = await docker('docker', [
        'container', 'inspect', '--format', '{{.Created}} {{.State.Status}} {{.Config.Image}} {{index .Config.Labels "tankscript.runner"}}',
        id,
      ], options);
      const [created, status, containerImage, label] = details.stdout.trim().split(' ');
      if (status === 'created' && containerImage === image && label === '1' && now - Date.parse(created) >= 60_000) {
        // Never force removal here. A container that has started belongs to its controller.
        await docker('docker', ['container', 'rm', id], options);
      }
    } catch (error) {
      if (!/No such (container|object)|container is running|already in progress/i.test(error.stderr)) throw error;
    }
  }
}

function nonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function decodeEntries(entries, expectedIds, decode) {
  if (!Array.isArray(entries) || entries.length !== expectedIds.length) throw runnerError('PROTOCOL_ERROR');
  return entries.map((entry, index) => {
    const tankId = expectedIds[index];
    if (entry?.tankId !== tankId) throw runnerError('PROTOCOL_ERROR');
    if (hasKeys(entry, ['tankId', 'code']) && TANK_SCRIPT_PARTICIPANT_ERRORS.includes(entry.code)) {
      const { code, message } = new TankScriptRunnerError(entry.code);
      return { tankId, error: { code, message } };
    }
    return decode(entry);
  });
}

// Transport adapter for the Docker attachment and trusted process fixtures.
export async function connectTankRunner(child, tanks, { removeContainer, signal } = {}) {
  let pending;
  let cleanup;
  let disposal;
  let nextId = 1;

  const exited = new Promise(resolve => child.once('close', resolve));
  child.stderr.resume();

  function close(code) {
    if (cleanup) return cleanup;
    signal?.removeEventListener('abort', abort);
    const request = pending;
    pending = undefined;
    clearTimeout(request?.timer);
    child.stdin.destroy();
    child.kill('SIGKILL');
    cleanup = Promise.resolve().then(removeContainer).then(() => exited);
    // A later dispose still sees a failed removal if the request has already rejected.
    cleanup.catch(() => {});
    request?.reject(runnerError(code));
    return cleanup;
  }

  function abort() { close('DISPOSED'); }
  child.once('error', () => close('RUNNER_ERROR'));
  child.stdin.on('error', () => close('RUNNER_EXIT'));
  signal?.addEventListener('abort', abort, { once: true });

  async function readReplies() {
    try {
      for await (const reply of readMessages(child.stdout, MAX_REPLY_BYTES)) {
        if (!pending || reply?.id !== pending.id) throw runnerError('PROTOCOL_ERROR');
        if (reply.ok === false && hasKeys(reply, ['id', 'ok', 'code']) &&
            ['INVALID_REQUEST', 'RUNNER_ERROR'].includes(reply.code)) {
          close(reply.code);
          return;
        }
        if (reply.ok !== true || !hasKeys(reply, ['id', 'ok', 'result'])) throw runnerError('PROTOCOL_ERROR');

        const request = pending;
        pending = undefined;
        clearTimeout(request.timer);
        request.resolve(reply.result);
      }
      close('RUNNER_EXIT');
    } catch {
      close('PROTOCOL_ERROR');
    }
  }
  void readReplies();

  function assertReady() {
    if (cleanup || disposal) throw runnerError('DISPOSED');
    if (pending) throw runnerError('BUSY');
  }

  function request(type, fields, timeout) {
    const id = nextId;
    const frame = encodeMessage({ id, type, ...fields }, MAX_REQUEST_BYTES);
    nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => close('RUNNER_TIMEOUT'), timeout);
      pending = { id, resolve, reject, timer };
      child.stdin.write(frame, error => {
        if (error) close('RUNNER_EXIT');
      });
    });
  }

  async function dispose() {
    try {
      if (!cleanup && !pending) {
        const reply = await request('dispose', {}, TANK_SCRIPT_LIMITS.workerRequestMs);
        if (reply !== null) throw runnerError('PROTOCOL_ERROR');
      }
    } finally {
      await close('DISPOSED');
    }
  }

  try {
    if (signal?.aborted) throw runnerError('DISPOSED');
    const ids = validateParticipants(tanks);
    const ready = await request('initialize', { tanks }, TANK_SCRIPT_LIMITS.workerStartupMs);
    assertReady();
    if (!hasKeys(ready, ['entries', 'wasmInitializationMs']) ||
        !nonnegative(ready.wasmInitializationMs)) throw runnerError('PROTOCOL_ERROR');

    const initialization = decodeEntries(ready.entries, [...ids], ({ tankId, timings, ...extra }) => {
      if (Object.keys(extra).length !== 0 || !hasKeys(timings, ['initializationMs', 'compilationMs']) ||
          !nonnegative(timings.initializationMs) || !nonnegative(timings.compilationMs)) {
        throw runnerError('PROTOCOL_ERROR');
      }
      return { tankId, timings };
    });

    return {
      initialization,
      wasmInitializationMs: ready.wasmInitializationMs,
      async runTick(states) {
        assertReady();
        const expectedIds = validateSnapshots(states, ids).map(({ tankId }) => tankId);
        const reply = await request('runTick', { states }, TANK_SCRIPT_LIMITS.workerBatchMs);
        try {
          if (!hasKeys(reply, ['entries', 'executionMs']) ||
              !nonnegative(reply.executionMs)) throw runnerError('PROTOCOL_ERROR');

          const results = decodeEntries(reply.entries, expectedIds, entry => {
            if (!hasKeys(entry, ['tankId', 'action'])) throw runnerError('PROTOCOL_ERROR');
            return { tankId: entry.tankId, command: tankScriptCommand(entry.action ?? undefined) };
          });
          return { results, executionMs: reply.executionMs };
        } catch {
          await close('PROTOCOL_ERROR');
          throw runnerError('PROTOCOL_ERROR');
        }
      },
      async getStats() {
        assertReady();
        const reply = await request('stats', {}, TANK_SCRIPT_LIMITS.workerRequestMs);
        if (!hasKeys(reply, ['peakRssBytes', 'cpuMs', 'container']) ||
            !nonnegative(reply.peakRssBytes) || !nonnegative(reply.cpuMs) ||
            (reply.container !== null &&
              (!hasKeys(reply.container, ['peakBytes', 'cpuMs']) ||
                (reply.container.peakBytes !== null && !nonnegative(reply.container.peakBytes)) ||
                !nonnegative(reply.container.cpuMs)))) {
          await close('PROTOCOL_ERROR');
          throw runnerError('PROTOCOL_ERROR');
        }
        return reply;
      },
      dispose() {
        disposal ??= dispose();
        return disposal;
      },
    };
  } catch (error) {
    await close('DISPOSED');
    throw error;
  }
}

export async function startDockerTankRunner(tanks, { signal } = {}) {
  if (signal?.aborted) throw runnerError('DISPOSED');
  validateParticipants(tanks);
  encodeMessage({ id: 1, type: 'initialize', tanks }, MAX_REQUEST_BYTES);
  const name = 'tankscript-runner-' + randomUUID();
  let removal;

  async function forceRemoveContainer() {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        await docker('docker', ['container', 'rm', '--force', name], dockerOptions);
        return;
      } catch (error) {
        if (error.stderr?.includes('No such container')) return;
        if (!/removal of container .* is already in progress/.test(error.stderr)) break;
        // Docker's automatic removal can win the race with our cleanup.
        await delay(100);
      }
    }
    throw Object.assign(runnerError('CLEANUP_FAILED'), { containerName: name });
  }

  function removeContainer() {
    removal ??= forceRemoveContainer();
    return removal;
  }

  try {
    await docker('docker', [
      'container', 'create', '--name', name, '--label', 'tankscript.runner=1',
      '--pull=never', '--interactive', '--rm', '--network=none', '--ipc=none', '--cgroupns=private',
      '--read-only', '--user=10001:10001', '--cap-drop=ALL', '--security-opt=no-new-privileges=true',
      '--memory=' + CONTAINER_MEMORY_BYTES, '--memory-swap=' + CONTAINER_MEMORY_BYTES,
      '--cpus=1', '--pids-limit=' + CONTAINER_PIDS, '--log-driver=none', image,
    ], dockerOptions);
  } catch (error) {
    if (error.code === 'ENOENT') throw runnerError('DOCKER_UNAVAILABLE');
    await removeContainer();
    throw runnerError('CONTAINER_START_FAILED');
  }

  if (signal?.aborted) {
    await removeContainer();
    throw runnerError('DISPOSED');
  }

  const child = spawn('docker', ['container', 'start', '--attach', '--interactive', name], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const runner = await connectTankRunner(child, tanks, { removeContainer, signal });
  return { ...runner, containerName: name };
}
