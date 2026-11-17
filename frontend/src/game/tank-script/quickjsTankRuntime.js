import { DefaultIntrinsics, getQuickJS } from 'quickjs-emscripten';
import {
  TANK_SCRIPT_ACTIONS,
  TANK_SCRIPT_LIMITS,
  TankScriptRunnerError,
  tankScriptCommand,
  validateTankSource,
} from './tankScriptRunnerProtocol.js';

// This wrapper is trusted guest code. The player body arrives as a string argument.
const createGuestRunner = `(source => {
  const parse = JSON.parse;
  const freeze = Object.freeze;
  const keys = Object.keys;
  const runPlayerCode = new Function(
    ...${JSON.stringify(TANK_SCRIPT_ACTIONS)},
    'tankId', 'tankPosition', 'tankRotation', 'tankHealth',
    'allTanks', 'allBullets', 'arenaWidth', 'arenaHeight',
    source,
  );

  function freezeSnapshot(value) {
    if (!value || typeof value !== 'object') return value;
    const fields = keys(value);
    for (let index = 0; index < fields.length; index++) {
      freezeSnapshot(value[fields[index]]);
    }
    return freeze(value);
  }

  return snapshotJSON => {
    const state = freezeSnapshot(parse(snapshotJSON));
    let action;
    const submit = nextAction => {
      if (action === undefined) action = nextAction;
    };
    runPlayerCode(
      () => submit('moveUp'),
      () => submit('moveDown'),
      () => submit('moveLeft'),
      () => submit('moveRight'),
      () => submit('rotateLeft'),
      () => submit('rotateRight'),
      () => submit('shoot'),
      state.tankId, state.tankPosition, state.tankRotation, state.tankHealth,
      state.allTanks, state.allBullets, state.arenaWidth, state.arenaHeight,
    );
    return action;
  };
})`;

export async function createQuickJSTankRuntime(source, quickJS) {
  validateTankSource(source);
  const initializationStart = performance.now();
  quickJS ??= await getQuickJS();
  const runtime = quickJS.newRuntime();
  let context;
  let runGuestTick;
  let deadline = Infinity;
  let interrupted = false;

  function dispose() {
    try {
      runGuestTick?.dispose();
    } finally {
      try {
        context?.dispose();
      } finally {
        runtime.dispose();
      }
    }
  }

  // Discard guest exceptions without converting guest-owned objects in the host.
  function takeValue(result, errorCode) {
    const timedOut = interrupted || performance.now() >= deadline;
    if (result.error) {
      result.error.dispose();
      throw new TankScriptRunnerError(timedOut ? 'EXECUTION_TIMEOUT' : errorCode);
    }
    if (timedOut) {
      result.value.dispose();
      throw new TankScriptRunnerError('EXECUTION_TIMEOUT');
    }
    return result.value;
  }

  try {
    runtime.setMemoryLimit(TANK_SCRIPT_LIMITS.heapBytes);
    runtime.setMaxStackSize(TANK_SCRIPT_LIMITS.stackBytes);
    runtime.setInterruptHandler(() => {
      if (performance.now() >= deadline) interrupted = true;
      return interrupted;
    });
    context = runtime.newContext({
      intrinsics: {
        ...DefaultIntrinsics,
        Date: false,
        Promise: false,
        TypedArrays: false,
      },
    });
    const compilationStart = performance.now();
    deadline = compilationStart + TANK_SCRIPT_LIMITS.executionMs;
    const factory = takeValue(context.evalCode(createGuestRunner), 'WORKER_ERROR');
    try {
      const sourceHandle = context.newString(source);
      try {
        runGuestTick = takeValue(
          context.callFunction(factory, context.undefined, sourceHandle),
          'COMPILE_ERROR',
        );
      } finally {
        sourceHandle.dispose();
      }
    } finally {
      factory.dispose();
      deadline = Infinity;
    }
    const timings = {
      initializationMs: compilationStart - initializationStart,
      compilationMs: performance.now() - compilationStart,
    };

    return {
      timings,
      runTick(snapshotJSON) {
        if (!runtime.alive) throw new TankScriptRunnerError('DISPOSED');
        if (typeof snapshotJSON !== 'string' || snapshotJSON.length > TANK_SCRIPT_LIMITS.snapshotLength) {
          throw new TankScriptRunnerError('INVALID_SNAPSHOT');
        }

        interrupted = false;
        deadline = performance.now() + TANK_SCRIPT_LIMITS.executionMs;
        let snapshotHandle;
        let result;
        try {
          snapshotHandle = context.newString(snapshotJSON);
          result = takeValue(context.callFunction(runGuestTick, context.undefined, snapshotHandle), 'RUNTIME_ERROR');
          const type = context.typeof(result);
          if (type === 'undefined') return undefined;
          if (type !== 'string') throw new TankScriptRunnerError('INVALID_COMMAND');
          const action = context.getString(result);
          tankScriptCommand(action);
          return action;
        } finally {
          result?.dispose();
          snapshotHandle?.dispose();
          deadline = Infinity;
        }
      },
      getHeapUsageBytes() {
        if (!runtime.alive) throw new TankScriptRunnerError('DISPOSED');
        const usage = runtime.computeMemoryUsage();
        try {
          const bytes = context.getProp(usage, 'memory_used_size');
          try {
            return context.getNumber(bytes);
          } finally {
            bytes.dispose();
          }
        } finally {
          usage.dispose();
        }
      },
      dispose() {
        if (runtime.alive) dispose();
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
