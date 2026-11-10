import {
  TANK_SCRIPT_LIMITS,
  TankScriptRunnerError,
  serializeTankSnapshot,
  tankScriptCommand,
  validateTankSource,
} from './tankScriptRunnerProtocol.js';

export async function createTankScriptWorkerRunner(source) {
  validateTankSource(source);

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
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    finishRequest()?.reject(new TankScriptRunnerError(code));
  }

  worker.onerror = event => {
    event.preventDefault();
    close('WORKER_ERROR');
  };
  worker.onmessageerror = () => close('WORKER_ERROR');
  worker.onmessage = ({ data }) => {
    if (!pending || data?.id !== pending.id) return;
    if (data.ok === true && Object.hasOwn(data, 'result')) {
      finishRequest().resolve(data.result);
    } else if (data.ok === false && typeof data.code === 'string') {
      const error = new TankScriptRunnerError(data.code);
      if (error.code === 'WORKER_ERROR') close(error.code);
      else finishRequest().reject(error);
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

  async function disposeRunner() {
    if (closed) return;
    try {
      // If a tick is in flight, termination cancels it without waiting for guest code.
      if (!pending) await request('dispose');
    } finally {
      close('DISPOSED');
    }
  }

  try {
    const timings = await request('initialize', { source }, TANK_SCRIPT_LIMITS.workerStartupMs);
    return {
      timings,
      async runTick(state) {
        if (closed || disposal) throw new TankScriptRunnerError('DISPOSED');
        const snapshotJSON = serializeTankSnapshot(state);
        const action = await request('runTick', { snapshotJSON });
        try {
          return tankScriptCommand(action);
        } catch (error) {
          close('INVALID_COMMAND');
          throw error;
        }
      },
      getHeapUsageBytes() {
        return request('heapUsage');
      },
      dispose() {
        disposal ??= disposeRunner();
        return disposal;
      },
    };
  } catch (error) {
    close('DISPOSED');
    throw error;
  }
}
