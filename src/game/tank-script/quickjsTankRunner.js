import { DefaultIntrinsics, getQuickJS } from 'quickjs-emscripten';

export const DEFAULT_QUICKJS_TANK_LIMITS = Object.freeze({
  executionTimeMs: 100,
  memoryLimitBytes: 16 * 1024 * 1024,
  stackLimitBytes: 512 * 1024,
});

const MAX_TANK_CODE_LENGTH = 100_000;

export class TankScriptExecutionError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = 'TankScriptExecutionError';
    this.code = code;
  }
}

function validateLimits(limits) {
  const resolved = { ...DEFAULT_QUICKJS_TANK_LIMITS, ...limits };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
  }
  return resolved;
}

function createRunnerSource(code) {
  return `(function() {
    function freezeDeep(value) {
      if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const key of Object.keys(value)) freezeDeep(value[key]);
      }
      return value;
    }

    function runPlayerCode(
      tankId, tankPosition, tankRotation, tankHealth,
      allTanks, allBullets, arenaWidth, arenaHeight,
      moveUp, moveDown, moveLeft, moveRight, rotateLeft, rotateRight, shoot
    ) {
      "use strict";
      ${code}
    }

    return function runTick(input) {
      "use strict";
      freezeDeep(input);
      let command;
      const submitAction = action => {
        if (command === undefined) command = Object.freeze({ action });
      };
      runPlayerCode(
        input.tankId, input.tankPosition, input.tankRotation, input.tankHealth,
        input.allTanks, input.allBullets, input.arenaWidth, input.arenaHeight,
        () => submitAction('moveUp'),
        () => submitAction('moveDown'),
        () => submitAction('moveLeft'),
        () => submitAction('moveRight'),
        () => submitAction('rotateLeft'),
        () => submitAction('rotateRight'),
        () => submitAction('shoot'),
      );

      return command;
    };
  })()`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function disposeResources(handles, context, runtime) {
  let disposalError;
  for (const handle of handles) {
    if (!handle?.alive) continue;
    try {
      handle.dispose();
    } catch (error) {
      disposalError ??= error;
    }
  }
  try {
    if (context?.alive) context.dispose();
  } catch (error) {
    disposalError ??= error;
  } finally {
    try {
      if (runtime?.alive) runtime.dispose();
    } catch (error) {
      disposalError ??= error;
    }
  }
  if (disposalError) throw disposalError;
}

function useResult(context, result, callback) {
  try {
    return callback(context.unwrapResult(result));
  } finally {
    if (result.value?.alive) result.dispose();
  }
}

export async function createQuickJSTankRunner(tankCode, options = {}) {
  if (typeof tankCode !== 'string') {
    throw new TypeError('tankCode must be a string');
  }
  if (tankCode.length > MAX_TANK_CODE_LENGTH) {
    throw new RangeError(`tankCode exceeds ${MAX_TANK_CODE_LENGTH} characters`);
  }

  const limits = validateLimits(options);
  const quickJS = await getQuickJS();
  let runtime;
  let context;
  let functionHandle;
  let jsonParseHandle;
  let deadline = 0;
  let interrupted = false;

  try {
    runtime = quickJS.newRuntime();
    runtime.setMemoryLimit(limits.memoryLimitBytes);
    runtime.setMaxStackSize(limits.stackLimitBytes);
    runtime.setInterruptHandler(() => {
      if (deadline !== 0 && performance.now() >= deadline) {
        interrupted = true;
        return true;
      }
      return false;
    });
    context = runtime.newContext({
      intrinsics: {
        ...DefaultIntrinsics,
        Date: false,
        Promise: false,
        Proxy: false,
        RegExp: false,
        TypedArrays: false,
      },
    });

    deadline = performance.now() + limits.executionTimeMs;
    const compileResult = context.evalCode(createRunnerSource(tankCode));
    try {
      functionHandle = useResult(context, compileResult, handle => handle.dup());
    } catch (error) {
      const code = interrupted
        ? 'EXECUTION_TIMEOUT'
        : /out of memory|memory limit/i.test(errorMessage(error))
          ? 'MEMORY_LIMIT'
          : 'INVALID_JAVASCRIPT';
      throw new TankScriptExecutionError(
        code,
        `Unable to compile tank code: ${errorMessage(error)}`,
        error,
      );
    } finally {
      deadline = 0;
      interrupted = false;
    }

    const jsonHandle = context.getProp(context.global, 'JSON');
    try {
      jsonParseHandle = context.getProp(jsonHandle, 'parse');
    } finally {
      jsonHandle.dispose();
    }

    return new QuickJSTankRunner(runtime, context, functionHandle, jsonParseHandle, limits, () => {
      functionHandle = undefined;
      jsonParseHandle = undefined;
      context = undefined;
      runtime = undefined;
    });
  } catch (error) {
    disposeResources([functionHandle, jsonParseHandle], context, runtime);
    throw error;
  }
}

class QuickJSTankRunner {
  #runtime;
  #context;
  #functionHandle;
  #jsonParseHandle;
  #limits;
  #onDispose;
  #disposed = false;
  #deadline = 0;
  #interrupted = false;

  constructor(runtime, context, functionHandle, jsonParseHandle, limits, onDispose) {
    this.#runtime = runtime;
    this.#context = context;
    this.#functionHandle = functionHandle;
    this.#jsonParseHandle = jsonParseHandle;
    this.#limits = limits;
    this.#onDispose = onDispose;
    runtime.setInterruptHandler(() => {
      if (this.#deadline !== 0 && performance.now() >= this.#deadline) {
        this.#interrupted = true;
        return true;
      }
      return false;
    });
  }

  runTick(tankState) {
    if (this.#disposed) {
      throw new TankScriptExecutionError('DISPOSED', 'Tank runner has been disposed');
    }

    let serializedState;
    try {
      serializedState = JSON.stringify(tankState);
    } catch (error) {
      throw new TypeError(`tankState must be JSON-serializable: ${errorMessage(error)}`, { cause: error });
    }
    if (typeof serializedState !== 'string') {
      throw new TypeError('tankState must serialize to a JSON object');
    }

    let stateTextHandle;
    let stateResult;
    let callResult;
    this.#deadline = performance.now() + this.#limits.executionTimeMs;
    this.#interrupted = false;
    try {
      stateTextHandle = this.#context.newString(serializedState);
      stateResult = this.#context.callFunction(
        this.#jsonParseHandle,
        this.#context.undefined,
        stateTextHandle,
      );
      const command = useResult(this.#context, stateResult, stateHandle => {
        callResult = this.#context.callFunction(
          this.#functionHandle,
          this.#context.undefined,
          stateHandle,
        );
        return useResult(this.#context, callResult, resultHandle => this.#context.dump(resultHandle));
      });
      if (command === undefined) return undefined;
      if (!command || typeof command.action !== 'string') {
        throw new TankScriptExecutionError('INVALID_COMMAND', 'Tank code returned an invalid command');
      }
      return Object.freeze({ action: command.action });
    } catch (error) {
      if (error instanceof TankScriptExecutionError) throw error;
      const code = this.#interrupted
        ? 'EXECUTION_TIMEOUT'
        : /out of memory|memory limit/i.test(errorMessage(error))
          ? 'MEMORY_LIMIT'
          : 'RUNTIME_ERROR';
      throw new TankScriptExecutionError(
        code,
        `Tank code failed (${code}): ${errorMessage(error)}`,
        error,
      );
    } finally {
      stateTextHandle?.dispose();
      this.#deadline = 0;
      this.#interrupted = false;
    }
  }

  getMemoryUsage() {
    if (this.#disposed) {
      throw new TankScriptExecutionError('DISPOSED', 'Tank runner has been disposed');
    }
    const handle = this.#runtime.computeMemoryUsage();
    try {
      return this.#context.dump(handle);
    } finally {
      handle.dispose();
    }
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      disposeResources(
        [this.#functionHandle, this.#jsonParseHandle],
        this.#context,
        this.#runtime,
      );
    } finally {
      this.#onDispose();
    }
  }
}
