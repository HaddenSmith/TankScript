import 'ses';

lockdown();

let tankRuntime;

function sendError(id, code, error) {
  let message = 'Tank worker failed';
  try {
    if (typeof error === 'string') {
      message = error;
    } else if (error && typeof error.message === 'string') {
      message = error.message;
    }
  } catch {
    message = 'Tank worker failed with an unreadable error';
  }

  self.postMessage({
    type: 'error',
    id,
    code,
    message: message.slice(0, 1_000),
  });
}

function createTankRuntime() {
  const compartment = new Compartment();
  return compartment.evaluate(`(() => {
    let player;
    let randomState = 1;

    function freezeDeep(value) {
      if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const key of Object.keys(value)) freezeDeep(value[key]);
        Object.freeze(value);
      }
      return value;
    }

    function random() {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    }

    return {
      initialize(source, seed) {
        randomState = seed >>> 0 || 1;
        const tankMath = Object.create(Math);
        Object.defineProperty(tankMath, 'random', {
          value: Object.freeze(random),
          enumerable: false,
        });
        globalThis.Math = Object.freeze(tankMath);

        player = new Function(
          'tankId', 'tankPosition', 'tankRotation', 'tankHealth',
          'allTanks', 'allBullets', 'arenaWidth', 'arenaHeight',
          'moveUp', 'moveDown', 'moveLeft', 'moveRight',
          'rotateLeft', 'rotateRight', 'shoot',
          '"use strict";\\n' + source,
        );
      },

      runTick(stateJSON) {
        const state = freezeDeep(JSON.parse(stateJSON));
        if (!state || typeof state !== 'object' || Array.isArray(state)) {
          throw new TypeError('Tank state must be a JSON object');
        }

        let command;
        const submit = action => {
          if (command === undefined) command = { action };
        };
        player(
          state.tankId,
          state.tankPosition,
          state.tankRotation,
          state.tankHealth,
          state.allTanks,
          state.allBullets,
          state.arenaWidth,
          state.arenaHeight,
          () => submit('moveUp'),
          () => submit('moveDown'),
          () => submit('moveLeft'),
          () => submit('moveRight'),
          () => submit('rotateLeft'),
          () => submit('rotateRight'),
          () => submit('shoot'),
        );

        return command === undefined ? undefined : JSON.stringify(command);
      },
    };
  })()`);
}

function handleMessage({ data }) {
  const { id, type, code, stateJSON } = data;

  if (type === 'initialize') {
    try {
      if (typeof code !== 'string' || code.length > 100_000) {
        throw new RangeError('Tank code must be a string of at most 100000 characters');
      }

      let runtime;
      try {
        runtime = createTankRuntime();
      } catch (error) {
        sendError(id, 'SES_INITIALIZATION_ERROR', error);
        return;
      }

      const seedValues = new Uint32Array(1);
      crypto.getRandomValues(seedValues);
      try {
        runtime.initialize(code, seedValues[0]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = error?.code === 'SES_IMPORT_REJECTED' ||
          message.includes('SES_IMPORT_REJECTED')
          ? 'SES_IMPORT_REJECTED'
          : 'INVALID_JAVASCRIPT';
        sendError(id, code, error);
        return;
      }

      tankRuntime = runtime;
      self.postMessage({ type: 'initialized', id });
      return;
    } catch (error) {
      sendError(id, 'INITIALIZATION_ERROR', error);
      return;
    }
  }

  if (type === 'runTick') {
    if (!tankRuntime) {
      sendError(id, 'NOT_INITIALIZED', new Error('Tank worker is not initialized'));
      return;
    }
    if (typeof stateJSON !== 'string') {
      sendError(id, 'INVALID_STATE', new TypeError('Serialized tank state must be a string'));
      return;
    }

    const startedAt = performance.now();
    try {
      const commandJSON = tankRuntime.runTick(stateJSON);
      self.postMessage({
        type: 'result',
        id,
        commandJSON,
        executionMs: performance.now() - startedAt,
      });
    } catch (error) {
      sendError(id, 'RUNTIME_ERROR', error);
    }
    return;
  }

  sendError(id, 'INVALID_MESSAGE', new Error(`Unknown worker message: ${String(type)}`));
}

self.addEventListener('message', handleMessage);
self.postMessage({ type: 'ready' });
