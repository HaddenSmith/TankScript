import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { createBattleManager } from '../../../backend/battles/manager.js';
import { createBattleFromSelectedTanks } from '../../../shared/game/battleController.js';
import { createBattleStateSnapshot } from '../../../shared/game/battleState.js';
import { TANK_SCRIPT_ACTIONS } from '../../../shared/game/tank-script/tankScriptRunnerProtocol.js';

const savedTank = { id: 'community-1', name: 'Community tank', code: 'shoot();', color: '#123456' };
const selection = { type: 'community', id: savedTank.id };
const setup = { participants: [selection, selection], arenaSize: 8, startingHealth: 1, speed: 0.125 };

function commands(states, action) {
  return { results: states.map(({ tankId }) => ({ tankId, command: action ? { action } : undefined })) };
}

describe('authoritative battle manager', () => {
  let manager;
  let startRunner;
  let getTankById;
  let runner;

  beforeEach(() => {
    jest.useFakeTimers();
    runner = { runTick: jest.fn(async states => commands(states)), dispose: jest.fn(async () => {}) };
    startRunner = jest.fn(async () => runner);
    getTankById = jest.fn(async () => savedTank);
  });

  afterEach(async () => {
    await manager?.shutdown();
    manager = null;
    jest.useRealTimers();
  });

  function create(options = {}) {
    manager = createBattleManager({ startRunner, getTankById, ...options });
    return manager;
  }

  test('validates settings and uses the saved source even when a tank is selected twice', async () => {
    create();
    const injected = { ...setup, participants: [{ ...selection, code: 'rotateLeft();' }, selection] };
    await expect(manager.start('pilot', injected)).rejects.toMatchObject({ status: 400 });
    const battle = await manager.start('pilot', setup);
    expect(getTankById).toHaveBeenCalledTimes(1);
    expect(startRunner).toHaveBeenCalledWith([
      { tankId: 1, source: savedTank.code }, { tankId: 2, source: savedTank.code },
    ], { signal: expect.any(AbortSignal) });
    expect(battle.state).toMatchObject({ tickCount: 0, result: null });
    expect(battle.state.arena.tanks[0]).not.toHaveProperty('code');
    expect(() => manager.get('another-pilot', battle.id)).toThrow('Battle not found');
    expect(() => manager.get('pilot', 'bad-id')).toThrow('Invalid battle ID');
    expect(() => manager.updates('pilot', battle.id, -1)).toThrow('Invalid battle update cursor');
  });

  test.each(TANK_SCRIPT_ACTIONS)('matches the shared engine for a simultaneous %s batch', async action => {
    create();
    runner.runTick.mockImplementation(async states => commands(states, action));
    const reference = createBattleFromSelectedTanks([savedTank, savedTank], 8, 1);
    const battle = await manager.start('pilot', setup);
    reference.resolveTick({ 1: action, 2: action });
    await jest.advanceTimersByTimeAsync(125);
    expect(manager.get('pilot', battle.id).state).toMatchObject({
      ...createBattleStateSnapshot(reference, 1),
      tickCount: 1,
    });
  });

  test('reports an authoritative winner without exposing source and retains the final snapshot', async () => {
    create();
    runner.runTick.mockImplementation(async states => ({
      results: states.map(({ tankId }) => ({ tankId, command: tankId === 1 ? { action: 'moveLeft' } : undefined })),
    }));
    const battle = await manager.start('pilot', setup);
    await jest.advanceTimersByTimeAsync(250);
    const final = manager.get('pilot', battle.id);
    expect(final.phase).toBe('complete');
    expect(final.state.result).toMatchObject({ status: 'win', winner: { id: 2 }, reason: 'elimination' });
    expect(final.state.result.winner).not.toHaveProperty('code');
    const updates = manager.updates('pilot', battle.id, battle.sequence).updates;
    expect(updates.at(-1).effects).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'tank-destroyed' })]));
    expect(runner.dispose).toHaveBeenCalledTimes(1);
  });

  test('preserves a simultaneous tie and the existing no-progress limit', async () => {
    create();
    runner.runTick.mockImplementation(async states => commands(states, 'moveUp'));
    const first = await manager.start('pilot', setup);
    await jest.advanceTimersByTimeAsync(750);
    expect(manager.get('pilot', first.id).state.result).toMatchObject({ status: 'tie', reason: 'mutual-destruction' });
    runner.runTick.mockImplementation(async states => commands(states));
    const next = await manager.start('pilot', setup);
    await jest.advanceTimersByTimeAsync(125 * 125);
    expect(manager.get('pilot', next.id).state.result).toMatchObject({ status: 'tie', reason: 'stalemate', tickCount: 125 });
  });

  test('holds one pending batch during pause, applies it once after resume, and applies the new speed', async () => {
    create();
    let completeBatch;
    runner.runTick.mockImplementationOnce(states => new Promise(resolve => {
      completeBatch = () => resolve(commands(states, 'shoot'));
    }));
    const battle = await manager.start('pilot', setup);
    await jest.advanceTimersByTimeAsync(125);
    expect(runner.runTick).toHaveBeenCalledTimes(1);
    manager.pause('pilot', battle.id);
    manager.setSpeed('pilot', battle.id, 1);
    await jest.advanceTimersByTimeAsync(500);
    completeBatch();
    await jest.advanceTimersByTimeAsync(1);
    expect(manager.get('pilot', battle.id).state.tickCount).toBe(0);
    manager.resume('pilot', battle.id);
    await jest.advanceTimersByTimeAsync(1);
    expect(manager.get('pilot', battle.id).state.tickCount).toBe(1);
    expect(runner.runTick).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(runner.runTick).toHaveBeenCalledTimes(2);
  });

  test('rejects concurrent starts and cancels a container that finishes starting after reset', async () => {
    create();
    let ready;
    startRunner.mockImplementationOnce(() => new Promise(resolve => { ready = resolve; }));
    const controller = new AbortController();
    const pending = manager.start('pilot', setup, { signal: controller.signal });
    const cancellation = expect(pending).rejects.toMatchObject({ code: 'START_CANCELLED' });
    await jest.advanceTimersByTimeAsync(0);
    await expect(manager.start('other', setup)).rejects.toMatchObject({ code: 'BATTLE_CAPACITY' });
    controller.abort();
    ready(runner);
    await cancellation;
    expect(runner.dispose).toHaveBeenCalledTimes(1);
    await expect(manager.start('other', setup)).resolves.toMatchObject({ phase: 'running' });
  });

  test('stops during a pending batch and never commits the late result', async () => {
    create();
    let resolveTick;
    runner.runTick.mockImplementationOnce(states => new Promise(resolve => {
      resolveTick = () => resolve(commands(states, 'shoot'));
    }));
    const battle = await manager.start('pilot', setup);
    await jest.advanceTimersByTimeAsync(125);
    await manager.stop('pilot', battle.id);
    resolveTick();
    await jest.advanceTimersByTimeAsync(500);
    expect(manager.get('pilot', battle.id)).toMatchObject({ phase: 'stopped', state: { tickCount: 0 } });
    expect(runner.runTick).toHaveBeenCalledTimes(1);
  });

  test('reports Docker startup and tick failures as controlled errors and cleans up on shutdown', async () => {
    create();
    startRunner.mockRejectedValueOnce(Object.assign(new Error('private path'), { code: 'DOCKER_UNAVAILABLE' }));
    await expect(manager.start('pilot', setup)).rejects.toMatchObject({ status: 503, code: 'RUNNER_UNAVAILABLE' });
    runner.runTick.mockRejectedValueOnce(new Error('private Docker output'));
    const battle = await manager.start('pilot', setup);
    await jest.advanceTimersByTimeAsync(125);
    expect(manager.get('pilot', battle.id)).toMatchObject({ phase: 'stopped', error: { code: 'RUNNER_FAILED' } });
    await manager.start('pilot', setup);
    await manager.shutdown();
    expect(runner.dispose).toHaveBeenCalledTimes(2);
    await expect(manager.start('pilot', setup)).rejects.toMatchObject({ status: 503 });
  });

  test('resynchronizes past the update buffer, expires idle sessions, and removes retained snapshots', async () => {
    create({ updateLimit: 2, idleMs: 500, retentionMs: 250, sweepMs: 125 });
    const battle = await manager.start('pilot', setup);
    await jest.advanceTimersByTimeAsync(375);
    const response = manager.updates('pilot', battle.id, battle.sequence);
    expect(response).toMatchObject({ updates: [], resync: { state: { tickCount: 3 } } });
    await jest.advanceTimersByTimeAsync(500);
    expect(manager.get('pilot', battle.id).error.code).toBe('BATTLE_IDLE');
    await jest.advanceTimersByTimeAsync(250);
    expect(() => manager.get('pilot', battle.id)).toThrow('expired');
  });

  test('limits session duration even when the owner stays connected', async () => {
    create({ durationMs: 300, idleMs: 200, sweepMs: 50 });
    const battle = await manager.start('pilot', setup);
    for (let step = 0; step < 3; step++) {
      await jest.advanceTimersByTimeAsync(100);
      manager.get('pilot', battle.id);
    }
    expect(manager.get('pilot', battle.id).error.code).toBe('BATTLE_DURATION');
  });
});
