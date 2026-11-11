import {
  TANK_SCRIPT_LIMITS,
  serializeTankSnapshot,
  validateTankSource,
} from '../../shared/game/tank-script/tankScriptRunnerProtocol.js';

export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
export const MAX_REPLY_BYTES = 64 * 1024;
export const MAX_TICKS = 1_000;

const messages = {
  INVALID_REQUEST: 'Invalid TankScript runner request.',
  FRAME_LIMIT: 'TankScript IPC message exceeds the size limit.',
  PROTOCOL_ERROR: 'Invalid TankScript IPC message.',
  RUNNER_ERROR: 'The TankScript execution process failed.',
  RUNNER_EXIT: 'The TankScript execution process exited.',
  RUNNER_TIMEOUT: 'The TankScript execution process timed out.',
  BUSY: 'A TankScript request is already in progress.',
  DISPOSED: 'The TankScript runner is closed.',
  DOCKER_UNAVAILABLE: 'Docker is unavailable. Use a local Linux Docker engine.',
  CONTAINER_START_FAILED: 'Could not create the TankScript container. Verify the local image and Docker engine.',
  CLEANUP_FAILED: 'Could not confirm removal of the TankScript container.',
};

export function runnerError(code) {
  return Object.assign(new Error(messages[code]), { code });
}

export function hasKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function validId(id) {
  return Number.isSafeInteger(id) && id > 0;
}

export function validateParticipants(tanks) {
  if (!Array.isArray(tanks) || tanks.length < 1 || tanks.length > TANK_SCRIPT_LIMITS.participants) {
    throw runnerError('INVALID_REQUEST');
  }

  const ids = new Set();
  for (const tank of tanks) {
    if (!hasKeys(tank, ['tankId', 'source']) || !Number.isSafeInteger(tank.tankId) || ids.has(tank.tankId)) {
      throw runnerError('INVALID_REQUEST');
    }
    validateTankSource(tank.source);
    ids.add(tank.tankId);
  }
  return ids;
}

export function validateSnapshots(states, ids) {
  if (!Array.isArray(states) || states.length > ids.size) throw runnerError('INVALID_REQUEST');

  const seen = new Set();
  return states.map(state => {
    if (!hasKeys(state, [
      'tankId', 'tankPosition', 'tankRotation', 'tankHealth', 'allTanks', 'allBullets', 'arenaWidth', 'arenaHeight',
    ]) || !ids.has(state.tankId) || seen.has(state.tankId) || !(state.tankHealth > 0)) {
      throw runnerError('INVALID_REQUEST');
    }
    seen.add(state.tankId);

    const snapshotJSON = serializeTankSnapshot(state);
    if (!hasKeys(state.tankPosition, ['x', 'y']) ||
        !state.allTanks.every(tank => hasKeys(tank, ['id', 'name', 'x', 'y', 'rotation', 'health'])) ||
        !state.allBullets.every(bullet => hasKeys(bullet, ['id', 'ownerId', 'x', 'y', 'rotation']))) {
      throw runnerError('INVALID_REQUEST');
    }
    return { tankId: state.tankId, snapshotJSON };
  });
}

export function encodeMessage(message, limit) {
  const json = JSON.stringify(message);
  if (Buffer.byteLength(json) > limit) throw runnerError('FRAME_LIMIT');
  return json + '\n';
}

export async function* readMessages(stream, limit) {
  // A fixed buffer bounds memory even if a message arrives one byte at a time.
  const frame = Buffer.allocUnsafe(limit);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let length = 0;

  for await (const chunk of stream) {
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline === -1 ? chunk.length : newline;
      if (length + end - offset > limit) throw runnerError('FRAME_LIMIT');
      chunk.copy(frame, length, offset, end);
      length += end - offset;
      offset = end + 1;
      if (newline === -1) continue;

      let message;
      try {
        message = JSON.parse(decoder.decode(frame.subarray(0, length)));
      } catch {
        throw runnerError('PROTOCOL_ERROR');
      }
      length = 0;
      yield message;
    }
  }

  if (length !== 0) throw runnerError('PROTOCOL_ERROR');
}
