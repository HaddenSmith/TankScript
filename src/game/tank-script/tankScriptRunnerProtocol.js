export const TANK_SCRIPT_ACTIONS = Object.freeze([
  'moveUp', 'moveDown', 'moveLeft', 'moveRight', 'rotateLeft', 'rotateRight', 'shoot',
]);

export const TANK_SCRIPT_LIMITS = Object.freeze({
  sourceLength: 100_000,
  snapshotLength: 1_000_000,
  heapBytes: 16 * 1024 * 1024,
  // Leave room for QuickJS to unwind before the Wasm stack is exhausted.
  stackBytes: 64 * 1024,
  executionMs: 100,
  workerStartupMs: 5_000,
  workerRequestMs: 500,
});

const errorMessages = {
  INVALID_SOURCE: 'TankScript must be a string of at most 100,000 characters.',
  INVALID_SNAPSHOT: 'The tank snapshot contains invalid or oversized arena data.',
  COMPILE_ERROR: 'TankScript could not be compiled.',
  RUNTIME_ERROR: 'TankScript failed during execution.',
  INVALID_COMMAND: 'The runner returned an unsupported TankScript action.',
  EXECUTION_TIMEOUT: 'TankScript exceeded its execution time limit.',
  WORKER_TIMEOUT: 'The TankScript worker did not respond in time.',
  WORKER_ERROR: 'The TankScript worker failed.',
  BUSY: 'The TankScript worker already has a request in progress.',
  DISPOSED: 'The TankScript runner has been disposed.',
};

export class TankScriptRunnerError extends Error {
  constructor(code) {
    const knownCode = Object.hasOwn(errorMessages, code) ? code : 'WORKER_ERROR';
    super(errorMessages[knownCode]);
    this.name = 'TankScriptRunnerError';
    this.code = knownCode;
  }
}

export function validateTankSource(source) {
  if (typeof source !== 'string' || source.length > TANK_SCRIPT_LIMITS.sourceLength) {
    throw new TankScriptRunnerError('INVALID_SOURCE');
  }
}

export function tankScriptCommand(action) {
  if (action === undefined) return undefined;
  if (!TANK_SCRIPT_ACTIONS.includes(action)) {
    throw new TankScriptRunnerError('INVALID_COMMAND');
  }
  return Object.freeze({ action });
}

function copyFields(value, fields) {
  const copy = {};
  for (const field of fields) {
    const entry = value?.[field];
    if (!Number.isFinite(entry)) throw new TankScriptRunnerError('INVALID_SNAPSHOT');
    copy[field] = entry;
  }
  return copy;
}

export function serializeTankSnapshot(state) {
  const allTanks = state?.allTanks;
  const allBullets = state?.allBullets;
  if (!Array.isArray(allTanks) || !Array.isArray(allBullets) || allTanks.length + allBullets.length > 4_096) {
    throw new TankScriptRunnerError('INVALID_SNAPSHOT');
  }

  // Cap aggregate name length before building the JSON string.
  let nameLength = 0;
  const snapshot = {
    ...copyFields(state, ['tankId', 'tankRotation', 'tankHealth', 'arenaWidth', 'arenaHeight']),
    tankPosition: copyFields(state.tankPosition, ['x', 'y']),
    allTanks: Array.from(allTanks, tank => {
      const name = tank?.name;
      if (typeof name !== 'string') throw new TankScriptRunnerError('INVALID_SNAPSHOT');
      nameLength += name.length;
      if (nameLength > TANK_SCRIPT_LIMITS.snapshotLength) {
        throw new TankScriptRunnerError('INVALID_SNAPSHOT');
      }
      const fields = copyFields(tank, ['id', 'x', 'y', 'rotation', 'health']);
      return { id: fields.id, name, ...fields };
    }),
    allBullets: Array.from(allBullets, bullet => copyFields(bullet, ['id', 'ownerId', 'x', 'y', 'rotation'])),
  };
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > TANK_SCRIPT_LIMITS.snapshotLength) {
    throw new TankScriptRunnerError('INVALID_SNAPSHOT');
  }
  return serialized;
}
