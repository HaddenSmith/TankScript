const DEFAULT_OPTIONS = Object.freeze({
  executionTimeMs: 100,
  startupTimeMs: 5_000,
});
const MAX_TANK_CODE_LENGTH = 100_000;
const MAX_STATE_LENGTH = 1_000_000;
const ACTIONS = new Set([
  'moveUp',
  'moveDown',
  'moveLeft',
  'moveRight',
  'rotateLeft',
  'rotateRight',
  'shoot',
]);

export class SESTankExecutionError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = 'SESTankExecutionError';
    this.code = code;
  }
}

function validateOptions(options) {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
  }
  return resolved;
}

function validateCode(code) {
  if (typeof code !== 'string') throw new TypeError('tankCode must be a string');
  if (code.length > MAX_TANK_CODE_LENGTH) {
    throw new RangeError(`tankCode exceeds ${MAX_TANK_CODE_LENGTH} characters`);
  }
}

function toExecutionError(message, fallbackCode = 'WORKER_ERROR') {
  return new SESTankExecutionError(
    message?.code || fallbackCode,
    message?.message || 'SES tank worker failed',
  );
}

function serializeState(tankState) {
  let stateJSON;
  try {
    stateJSON = JSON.stringify(tankState);
  } catch (error) {
    throw new TypeError(`tankState must be JSON-serializable: ${error.message}`, { cause: error });
  }
  if (typeof stateJSON !== 'string' || stateJSON[0] !== '{') {
    throw new TypeError('tankState must serialize to a JSON object');
  }
  if (stateJSON.length > MAX_STATE_LENGTH) {
    throw new RangeError(`Serialized tankState exceeds ${MAX_STATE_LENGTH} characters`);
  }
  return stateJSON;
}

export async function createSESTankRunner(tankCode, options = {}) {
  validateCode(tankCode);
  const runner = new SESTankRunner(tankCode, validateOptions(options));
  try {
    await runner.initialize();
    return runner;
  } catch (error) {
    runner.dispose();
    throw error;
  }
}

class SESTankRunner {
  #tankCode;
  #options;
  #worker;
  #pending;
  #startup;
  #disposed = false;
  #busy = false;
  #nextRequestId = 1;
  #metrics = {
    workerStarts: 0,
    workerTerminations: 0,
    workerReadyMs: 0,
    compilationMs: 0,
    stateSerializationMs: 0,
    roundTripMs: 0,
    workerExecutionMs: 0,
  };

  constructor(tankCode, options) {
    this.#tankCode = tankCode;
    this.#options = options;
  }

  async initialize() {
    await this.#initializeWorker();
  }

  async #initializeWorker() {
    if (this.#disposed) {
      throw new SESTankExecutionError('DISPOSED', 'Tank runner has been disposed');
    }
    if (this.#worker) return;
    if (typeof Worker === 'undefined') {
      throw new SESTankExecutionError(
        'UNSUPPORTED_ENVIRONMENT',
        'SES tank execution requires browser module workers',
      );
    }

    let worker;
    try {
      worker = new Worker(new URL('./sesTankWorker.js', import.meta.url), {
        type: 'module',
        name: 'tankscript-ses-tank',
      });
    } catch (error) {
      throw new SESTankExecutionError(
        'WORKER_START_FAILED',
        'Unable to create the SES module worker',
        error,
      );
    }
    this.#worker = worker;
    this.#metrics.workerStarts += 1;

    await new Promise((resolve, reject) => {
      const startedAt = performance.now();
      const timer = setTimeout(() => {
        this.#failWorker(
          worker,
          new SESTankExecutionError('WORKER_STARTUP_TIMEOUT', 'SES worker did not become ready'),
        );
      }, this.#options.startupTimeMs);
      this.#startup = { resolve, reject, timer, startedAt, worker };

      worker.onmessage = event => this.#handleMessage(worker, event.data);
      worker.onerror = event => {
        event.preventDefault();
        this.#failWorker(
          worker,
          new SESTankExecutionError('WORKER_ERROR', event.message || 'SES worker failed to start'),
        );
      };
      worker.onmessageerror = () => {
        this.#failWorker(
          worker,
          new SESTankExecutionError('WORKER_MESSAGE_ERROR', 'SES worker sent an unreadable message'),
        );
      };
    });

    const compileStartedAt = performance.now();
    const response = await this.#request(
      'initialize',
      { code: this.#tankCode },
      this.#options.startupTimeMs,
      'INITIALIZATION_TIMEOUT',
    );
    this.#metrics.compilationMs += performance.now() - compileStartedAt;
    if (response.type !== 'initialized') {
      throw toExecutionError(response, 'INITIALIZATION_ERROR');
    }
  }

  #handleMessage(worker, message) {
    if (message?.type === 'ready') {
      const startup = this.#startup;
      if (!startup || startup.worker !== worker) return;
      clearTimeout(startup.timer);
      this.#startup = undefined;
      this.#metrics.workerReadyMs += performance.now() - startup.startedAt;
      startup.resolve();
      return;
    }

    const pending = this.#pending;
    if (!pending || pending.worker !== worker || message?.id !== pending.id) return;
    clearTimeout(pending.timer);
    this.#pending = undefined;
    this.#metrics.roundTripMs += performance.now() - pending.sentAt;

    if (message.type === 'error') {
      pending.reject(toExecutionError(message));
      return;
    }
    if (message.type === 'result') {
      this.#metrics.workerExecutionMs += message.executionMs;
      pending.resolve(message);
      return;
    }
    if (message.type === 'initialized') {
      pending.resolve(message);
      return;
    }
    pending.reject(new SESTankExecutionError('WORKER_PROTOCOL_ERROR', 'Unexpected SES worker response'));
  }

  #request(type, payload, timeoutMs, timeoutCode) {
    const worker = this.#worker;
    if (!worker) {
      return Promise.reject(new SESTankExecutionError('WORKER_UNAVAILABLE', 'SES worker is unavailable'));
    }
    if (this.#pending) {
      return Promise.reject(new SESTankExecutionError('BUSY', 'A tank tick is already running'));
    }

    const id = this.#nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#failWorker(
          worker,
          new SESTankExecutionError(timeoutCode, `Tank execution exceeded ${timeoutMs} ms`),
        );
      }, timeoutMs);
      this.#pending = {
        id,
        worker,
        resolve,
        reject,
        timer,
        sentAt: performance.now(),
      };

      try {
        worker.postMessage({ id, type, ...payload });
      } catch (error) {
        this.#failWorker(
          worker,
          new SESTankExecutionError('WORKER_POST_ERROR', 'Unable to send a message to the SES worker', error),
        );
      }
    });
  }

  #failWorker(worker, error) {
    if (this.#startup?.worker === worker) {
      clearTimeout(this.#startup.timer);
      this.#startup.reject(error);
      this.#startup = undefined;
    }
    if (this.#pending?.worker === worker) {
      clearTimeout(this.#pending.timer);
      this.#pending.reject(error);
      this.#pending = undefined;
    }
    if (this.#worker !== worker) return;

    this.#worker = undefined;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    this.#metrics.workerTerminations += 1;
  }

  async runTick(tankState) {
    if (this.#disposed) {
      throw new SESTankExecutionError('DISPOSED', 'Tank runner has been disposed');
    }
    if (this.#busy) {
      throw new SESTankExecutionError('BUSY', 'A tank tick is already running');
    }
    this.#busy = true;
    try {
      const serializationStartedAt = performance.now();
      const stateJSON = serializeState(tankState);
      this.#metrics.stateSerializationMs += performance.now() - serializationStartedAt;
      await this.#initializeWorker();
      const response = await this.#request(
        'runTick',
        { stateJSON },
        this.#options.executionTimeMs,
        'EXECUTION_TIMEOUT',
      );
      if (response.commandJSON === undefined) return undefined;

      let command;
      try {
        command = JSON.parse(response.commandJSON);
      } catch (error) {
        throw new SESTankExecutionError('INVALID_COMMAND', 'Tank worker returned invalid command JSON', error);
      }
      if (!command || !ACTIONS.has(command.action)) {
        throw new SESTankExecutionError('INVALID_COMMAND', 'Tank code returned an unsupported action');
      }
      return Object.freeze({ action: command.action });
    } finally {
      this.#busy = false;
    }
  }

  getMetrics() {
    return Object.freeze({ ...this.#metrics });
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    const worker = this.#worker;
    if (!worker) return;
    this.#failWorker(
      worker,
      new SESTankExecutionError('DISPOSED', 'Tank runner has been disposed'),
    );
  }
}
