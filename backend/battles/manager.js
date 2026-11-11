import { randomUUID } from 'node:crypto';
import {
  BATTLE_SPEED_OPTIONS,
  MAX_ARENA_SIZE,
  MIN_ARENA_SIZE,
  createBattleFromSelectedTanks,
  maxBattleParticipants,
} from '../../shared/game/battleController.js';
import { createBattleEventsFromSnapshots, createBattleStateSnapshot } from '../../shared/game/battleState.js';
import firefly from '../../shared/game/builtInTanks/easyTank.js';
import bloodhound from '../../shared/game/builtInTanks/mediumTank.js';
import sidewinder from '../../shared/game/builtInTanks/hardTank.js';
import prism from '../../shared/game/builtInTanks/expertTank.js';
import checkmate from '../../shared/game/builtInTanks/overkillTank.js';
import { TankScriptRunnerError, tankScriptCommand, validateTankSource } from '../../shared/game/tank-script/tankScriptRunnerProtocol.js';
import { startDockerTankRunner } from '../tank-runner/client.js';
import { hasKeys } from '../tank-runner/protocol.js';

const officialTanks = new Map([firefly, bloodhound, sidewinder, prism, checkmate].map(tank => [tank.id, tank]));
const battleIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maxEvents = 50;

export class BattleError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function validateBattleSpeed(speed) {
  if (!BATTLE_SPEED_OPTIONS.includes(speed)) {
    throw new BattleError(400, 'INVALID_SPEED', 'Choose a supported battle speed.');
  }
}

function validateBattleSetup(setup) {
  if (!hasKeys(setup, ['participants', 'arenaSize', 'startingHealth', 'speed']) ||
      !Number.isInteger(setup.arenaSize) || setup.arenaSize < MIN_ARENA_SIZE || setup.arenaSize > MAX_ARENA_SIZE ||
      !Number.isInteger(setup.startingHealth) || setup.startingHealth < 1 || setup.startingHealth > 5 ||
      !Array.isArray(setup.participants) || setup.participants.length < 2 ||
      setup.participants.length > maxBattleParticipants(setup.arenaSize) ||
      setup.participants.some(tank => !hasKeys(tank, ['type', 'id']) ||
        !['official', 'community'].includes(tank.type) ||
        typeof tank.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(tank.id))) {
    throw new BattleError(400, 'INVALID_SETUP', 'Choose valid tanks, arena size, and starting health.');
  }
  validateBattleSpeed(setup.speed);
}

function publicResult(result, snapshot) {
  if (result === null) return null;
  const winner = result.winner ? snapshot.arena.tanks.find(tank => tank.id === result.winner.id) : null;
  return { status: result.status, reason: result.reason, tickCount: result.tickCount, winner };
}

function safeStartupError(error) {
  if (error instanceof BattleError) return error;
  if (['FRAME_LIMIT', 'INVALID_SOURCE'].includes(error?.code)) {
    return new BattleError(422, 'TANK_SOURCE_LIMIT', 'The selected tank scripts exceed the runner input limits.');
  }
  return new BattleError(503, 'RUNNER_UNAVAILABLE', 'The isolated battle runner could not start. Check Docker and the runner image.');
}

export function createBattleManager({
  getTankById,
  startRunner = startDockerTankRunner,
  maxActive = 1,
  maxRetained = 12,
  updateLimit = 24,
  startupMs = 18_000,
  durationMs = 270_000,
  idleMs = 30_000,
  retentionMs = 120_000,
  sweepMs = 5_000,
}) {
  const sessions = new Map();
  const active = new Set();
  let shuttingDown = false;
  let cleanupBlocked = false;

  function view(battle) {
    return {
      id: battle.id,
      sequence: battle.sequence,
      phase: battle.phase,
      speed: battle.speed,
      state: battle.state,
      error: battle.failure ? { code: battle.failure.code, message: battle.failure.message } : null,
    };
  }

  function publish(battle, effects = []) {
    battle.sequence++;
    battle.updates.push({ battle: view(battle), effects });
    if (battle.updates.length > updateLimit) battle.updates.shift();
  }

  function noteCleanupError(battle, error) {
    if (error?.code !== 'CLEANUP_FAILED' || battle.cleanupFailed) return;
    battle.cleanupFailed = true;
    cleanupBlocked = true;
    console.error('TankScript could not confirm removal of a battle container.', error.containerName ?? '');
  }

  function finish(battle, phase, failure = null, effects = []) {
    if (battle.cleanup) return battle.cleanup;
    battle.phase = phase;
    battle.failure = failure;
    battle.endedAt = Date.now();
    clearTimeout(battle.timer);
    clearTimeout(battle.startupTimer);
    battle.held = null;
    if (phase !== 'complete') battle.controller.abort();
    publish(battle, effects);
    battle.cleanup = (async () => {
      await battle.startup?.catch(error => noteCleanupError(battle, error));
      try {
        await battle.runner?.dispose();
      } catch (error) {
        noteCleanupError(battle, error);
      } finally {
        battle.engine = null;
        battle.runner = null;
        battle.startup = null;
        active.delete(battle);
        prune(Date.now());
      }
    })();
    return battle.cleanup;
  }

  function prune(now) {
    const finished = [...sessions.values()].filter(battle => battle.endedAt !== null && !active.has(battle));
    finished.sort((first, second) => first.endedAt - second.endedAt);
    for (const [index, battle] of finished.entries()) {
      if (now - battle.endedAt >= retentionMs || index < finished.length - maxRetained) {
        sessions.delete(battle.id);
      }
    }
  }

  function checkExpiry(battle, now) {
    if (battle.phase === 'starting' || battle.endedAt !== null) return false;
    if (now - battle.startedAt >= durationMs) {
      void finish(battle, 'stopped', new BattleError(409, 'BATTLE_DURATION', 'The battle reached its session time limit.'));
      return true;
    }
    if (now - battle.lastSeenAt >= idleMs) {
      void finish(battle, 'stopped', new BattleError(409, 'BATTLE_IDLE', 'The battle stopped after the page disconnected.'));
      return true;
    }
    return false;
  }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const battle of active) checkExpiry(battle, now);
    prune(now);
  }, sweepMs);
  sweep.unref?.();

  function lookup(owner, id) {
    if (typeof id !== 'string' || !battleIdPattern.test(id)) {
      throw new BattleError(400, 'INVALID_BATTLE_ID', 'Invalid battle ID.');
    }
    const now = Date.now();
    prune(now);
    const battle = sessions.get(id);
    if (!battle || battle.owner !== owner || battle.phase === 'starting') {
      throw new BattleError(404, 'BATTLE_NOT_FOUND', 'Battle not found or expired.');
    }
    checkExpiry(battle, now);
    battle.lastSeenAt = now;
    return battle;
  }

  function schedule(battle) {
    clearTimeout(battle.timer);
    if (battle.phase !== 'running' || battle.inFlight) return;
    const elapsed = battle.tickStartedAt === null ? 0 : performance.now() - battle.tickStartedAt;
    const delay = battle.held ? 0 : Math.max(0, battle.speed * 1000 - elapsed);
    battle.timer = setTimeout(() => void advance(battle), delay);
  }

  async function advance(battle) {
    if (battle.phase !== 'running' || checkExpiry(battle, Date.now())) return;
    try {
      if (!battle.held) {
        const states = battle.engine.getTankScriptStates();
        battle.tickStartedAt = performance.now();
        battle.inFlight = true;
        const { results } = await battle.runner.runTick(states);
        battle.inFlight = false;
        if (battle.endedAt !== null || checkExpiry(battle, Date.now())) return;
        if (results.length !== states.length || results.some((entry, index) => entry.tankId !== states[index].tankId)) {
          throw new Error('Incomplete command batch.');
        }
        battle.held = results;
      }
      if (battle.phase !== 'running') return;

      const commands = {};
      const notices = [];
      for (const { tankId, command, error } of battle.held) {
        if (command) commands[tankId] = tankScriptCommand(command.action).action;
        if (error && !battle.reportedIssues.has(tankId + ':' + error.code)) {
          battle.reportedIssues.add(tankId + ':' + error.code);
          const name = battle.engine.arena.getTankById(tankId).name;
          notices.push(`${name}: ${new TankScriptRunnerError(error.code).message}`);
        }
      }
      battle.held = null;
      const result = battle.engine.resolveTick(commands);
      const snapshot = createBattleStateSnapshot(battle.engine, battle.state.startingHealth);
      const effects = battle.engine.getLastTickEvents().map(effect => ({ ...effect, id: battle.nextEffectId++ }));
      const events = createBattleEventsFromSnapshots(battle.state, snapshot, result);
      battle.state = {
        ...snapshot,
        tickCount: battle.engine.getTickCount(),
        result: publicResult(result, snapshot),
        events: [...battle.state.events, ...notices, ...events].slice(-maxEvents),
      };
      if (result) {
        void finish(battle, 'complete', null, effects);
      } else {
        publish(battle, effects);
        schedule(battle);
      }
    } catch (error) {
      battle.inFlight = false;
      noteCleanupError(battle, error);
      if (battle.endedAt === null) {
        void finish(battle, 'stopped', new BattleError(503, 'RUNNER_FAILED', 'The isolated battle runner stopped responding.'));
      }
    }
  }

  async function initialize(battle, setup) {
    const signal = battle.controller.signal;
    const community = new Map();
    const definitions = await Promise.all(setup.participants.map(async ({ type, id }) => {
      let tank;
      if (type === 'official') {
        tank = officialTanks.get(id);
      } else {
        // Community tanks follow the existing authenticated community catalog policy.
        if (!community.has(id)) {
          community.set(id, Promise.resolve().then(() => getTankById(id, { signal })).catch(() => {
            throw new BattleError(503, 'TANK_LOOKUP_FAILED', 'The server could not load a selected community tank.');
          }));
        }
        tank = await community.get(id);
      }
      if (!tank) throw new BattleError(404, 'TANK_NOT_FOUND', 'A selected tank is unavailable.');
      validateTankSource(tank.code);
      if (typeof tank.name !== 'string' || tank.name.length > 256) {
        throw new BattleError(422, 'TANK_NAME_LIMIT', 'A selected tank name exceeds 256 characters.');
      }
      return tank;
    }));
    signal.throwIfAborted();
    battle.engine = createBattleFromSelectedTanks(definitions, setup.arenaSize, setup.startingHealth);
    const tanks = battle.engine.arena.tanks;
    battle.runner = await startRunner(tanks.map(({ id, code }) => ({ tankId: id, source: code })), { signal });
    signal.throwIfAborted();
    const snapshot = createBattleStateSnapshot(battle.engine, setup.startingHealth);
    const roster = tanks.map(tank => `Tank #${tank.id} (${tank.name})`).join(', ');
    battle.state = { ...snapshot, tickCount: 0, result: null, events: [`Battle started: ${roster}.`] };
    battle.startedAt = battle.lastSeenAt = Date.now();
    battle.phase = 'running';
    publish(battle);
    schedule(battle);
  }

  return {
    async start(owner, setup, { signal } = {}) {
      validateBattleSetup(setup);
      signal?.throwIfAborted();
      if (shuttingDown || cleanupBlocked) {
        throw new BattleError(503, 'RUNNER_UNAVAILABLE', 'The battle runner is unavailable.');
      }
      if (active.size >= maxActive) {
        throw new BattleError(409, 'BATTLE_CAPACITY', 'The server already has an active battle. Try again shortly.');
      }
      const battle = {
        id: randomUUID(), owner, phase: 'starting', speed: setup.speed, sequence: 0,
        state: null, updates: [], nextEffectId: 1, reportedIssues: new Set(),
        controller: new AbortController(), tickStartedAt: null, endedAt: null,
      };
      const cancel = () => void finish(battle, 'stopped', new BattleError(409, 'START_CANCELLED', 'Battle startup was cancelled.'));
      active.add(battle);
      sessions.set(battle.id, battle);
      battle.startup = initialize(battle, setup);
      battle.startupTimer = setTimeout(() => {
        void finish(battle, 'stopped', new BattleError(503, 'START_TIMEOUT', 'The battle runner took too long to start.'));
      }, startupMs);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      try {
        await battle.startup;
        if (battle.failure) throw battle.failure;
        return view(battle);
      } catch (error) {
        const failure = battle.failure ?? safeStartupError(error);
        await finish(battle, 'stopped', failure);
        sessions.delete(battle.id);
        throw failure;
      } finally {
        clearTimeout(battle.startupTimer);
        signal?.removeEventListener('abort', cancel);
      }
    },
    get(owner, id) {
      return view(lookup(owner, id));
    },
    updates(owner, id, since) {
      if (!Number.isSafeInteger(since) || since < 0) {
        throw new BattleError(400, 'INVALID_CURSOR', 'Invalid battle update cursor.');
      }
      const battle = lookup(owner, id);
      if (since > battle.sequence || since < battle.updates[0].battle.sequence - 1) {
        return { updates: [], resync: view(battle) };
      }
      return { updates: battle.updates.filter(update => update.battle.sequence > since), resync: null };
    },
    pause(owner, id) {
      const battle = lookup(owner, id);
      if (battle.phase === 'running') {
        battle.phase = 'paused';
        clearTimeout(battle.timer);
        publish(battle);
      }
      return view(battle);
    },
    resume(owner, id) {
      const battle = lookup(owner, id);
      if (battle.phase === 'paused') {
        battle.phase = 'running';
        battle.tickStartedAt = null;
        publish(battle);
        schedule(battle);
      }
      return view(battle);
    },
    setSpeed(owner, id, speed) {
      validateBattleSpeed(speed);
      const battle = lookup(owner, id);
      if (battle.endedAt === null && battle.speed !== speed) {
        battle.speed = speed;
        publish(battle);
        schedule(battle);
      }
      return view(battle);
    },
    async stop(owner, id) {
      const battle = lookup(owner, id);
      await finish(battle, 'stopped');
      if (battle.cleanupFailed) {
        throw new BattleError(503, 'CLEANUP_FAILED', 'The server could not confirm battle container cleanup.');
      }
    },
    get runnerBlocked() {
      return cleanupBlocked;
    },
    async shutdown() {
      shuttingDown = true;
      clearInterval(sweep);
      await Promise.all([...active].map(battle => finish(battle, 'stopped')));
    },
  };
}
