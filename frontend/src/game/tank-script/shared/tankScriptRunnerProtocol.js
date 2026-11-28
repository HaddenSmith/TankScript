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
  participants: 12,
  // A serial batch must leave time for healthy tanks after interpreter timeouts.
  workerBatchMs: 1_500,
});

export const TANK_SCRIPT_PARTICIPANT_ERRORS = Object.freeze([
  'INVALID_SOURCE', 'COMPILE_ERROR', 'RUNTIME_ERROR', 'EXECUTION_TIMEOUT', 'INVALID_COMMAND',
]);

const errorMessages = {
  INVALID_BATCH: 'A battle batch requires unique, registered tank IDs and valid snapshots.',
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

export class TankScriptCompileError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = 'TankScriptCompileError';
    this.diagnostics = diagnostics;
  }
}

export class TankScriptExecutionError extends TankScriptRunnerError {
  constructor(code, message) {
    super(code);
    this.name = 'TankScriptExecutionError';
    this.message = message;
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

export function validateBattleParticipants(participants) {
  if (!Array.isArray(participants) || participants.length === 0 ||
      participants.length > TANK_SCRIPT_LIMITS.participants) {
    throw new TankScriptRunnerError('INVALID_BATCH');
  }
  const ids = new Set();
  for (const tank of participants) {
    if (!Number.isSafeInteger(tank?.tankId) || ids.has(tank.tankId)) {
      throw new TankScriptRunnerError('INVALID_BATCH');
    }
    ids.add(tank.tankId);
  }
  return ids;
}

export function validateBattleStates(states, ids) {
  if (!Array.isArray(states) || states.length > ids.size) {
    throw new TankScriptRunnerError('INVALID_BATCH');
  }
  const seen = new Set();
  const alive = [];
  for (const state of states) {
    const tankId = state?.tankId;
    if (!ids.has(tankId) || seen.has(tankId) || !Number.isFinite(state.tankHealth)) {
      throw new TankScriptRunnerError('INVALID_BATCH');
    }
    seen.add(tankId);
    if (state.tankHealth > 0) alive.push(state);
  }
  return alive;
}

function copyFields(value, fields, defaults = {}) {
  const copy = {};
  for (const field of fields) {
    const entry = value?.[field] === undefined ? defaults[field] : value[field];
    if (!Number.isFinite(entry)) throw new TankScriptRunnerError('INVALID_SNAPSHOT');
    copy[field] = entry;
  }
  return copy;
}

export function serializeTankSnapshot(state) {
  const allTanks = state?.allTanks;
  const allBullets = state?.allBullets;
  const allWalls = state?.allWalls === undefined ? [] : state.allWalls;
  const allPowerups = state?.allPowerups === undefined ? [] : state.allPowerups;
  if (![allTanks, allBullets, allWalls, allPowerups].every(Array.isArray) ||
      allTanks.length + allBullets.length + allWalls.length + allPowerups.length > 4_096) {
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
      return { id: fields.id, name, ...fields, ...copyFields(tank, ['maxHealth', 'bulletSpeed', 'lightningTicksRemaining'], {
        maxHealth: fields.health, bulletSpeed: 0.5, lightningTicksRemaining: 0,
      }) };
    }),
    allBullets: Array.from(allBullets, bullet => copyFields(bullet, ['id', 'ownerId', 'x', 'y', 'rotation', 'speed'], { speed: 0.5 })),
    allWalls: Array.from(allWalls, wall => copyFields(wall, ['x', 'y', 'health', 'maxHealth'])),
    allPowerups: Array.from(allPowerups, powerup => {
      if (powerup?.type !== 'heart' && powerup?.type !== 'lightning') {
        throw new TankScriptRunnerError('INVALID_SNAPSHOT');
      }
      return { type: powerup.type, ...copyFields(powerup, ['x', 'y']) };
    }),
  };
  const ownTank = snapshot.allTanks.find(tank => tank.id === snapshot.tankId);
  Object.assign(snapshot, copyFields(state, ['tankMaxHealth', 'tankBulletSpeed', 'tankLightningTicksRemaining'], {
    tankMaxHealth: ownTank?.maxHealth ?? snapshot.tankHealth,
    tankBulletSpeed: ownTank?.bulletSpeed ?? 0.5,
    tankLightningTicksRemaining: ownTank?.lightningTicksRemaining ?? 0,
  }));
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > TANK_SCRIPT_LIMITS.snapshotLength) {
    throw new TankScriptRunnerError('INVALID_SNAPSHOT');
  }
  return serialized;
}
