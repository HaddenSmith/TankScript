import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { createMixedTankScriptBattleRunner } from '../../../frontend/src/game/tank-script/shared/mixedTankScriptRunner.js';
import { createPythonTankRunner } from '../../../frontend/src/game/tank-script/python/pythonTankRunner.js';
import { createJavaTankRunner } from '../../../frontend/src/game/tank-script/java/javaTankRunner.js';
import { createTankScriptBattleRunner } from '../../../frontend/src/game/tank-script/shared/tankScriptWorkerRunner.js';
import { TankScriptCompileError, TankScriptExecutionError } from '../../../frontend/src/game/tank-script/shared/tankScriptRunnerProtocol.js';

jest.mock('../../../frontend/src/game/tank-script/python/pythonTankRunner.js', () => ({ createPythonTankRunner: jest.fn() }));
jest.mock('../../../frontend/src/game/tank-script/java/javaTankRunner.js', () => ({ createJavaTankRunner: jest.fn() }));
jest.mock('../../../frontend/src/game/tank-script/shared/tankScriptFeatures.js', () => ({ JAVA_DEBUGGER_ENABLED: true, MAX_JAVA_BATTLE_TANKS: 4 }));
jest.mock('../../../frontend/src/game/tank-script/shared/tankScriptWorkerRunner.js', () => ({ createTankScriptBattleRunner: jest.fn() }));
const participants = [
  { tankId: 1, source: 'shoot()', language: 'python' },
  { tankId: 2, source: 'moveRight();', language: 'javascript' },
  { tankId: 3, source: 'const n: number = 1;', language: 'typescript' },
  { tankId: 4, source: 'move_left()', language: 'python' },
];
const ids = new Set([1, 2, 3, 4]);
let python;
let javascript;
let java;
beforeEach(() => {
  python = { timings: { initializationMs: 1 }, runTick: jest.fn().mockResolvedValue({ action: 'shoot' }), dispose: jest.fn().mockResolvedValue(undefined) };
  javascript = {
    initialization: [{ tankId: 2 }, { tankId: 3 }],
    runTick: jest.fn(async states => ({ results: states.map(({ tankId }) => ({ tankId, command: { action: 'moveRight' } })) })),
    dispose: jest.fn().mockResolvedValue(undefined),
  };
  createPythonTankRunner.mockReset().mockResolvedValue(python);
  createTankScriptBattleRunner.mockReset().mockResolvedValue(javascript);
  java = { timings: { initializationMs: 2 }, runTick: jest.fn().mockResolvedValue({ action: 'rotateRight' }), dispose: jest.fn().mockResolvedValue(undefined) };
  createJavaTankRunner.mockReset().mockResolvedValue(java);
});

describe('experimental Java mixed-language battles', () => {
  test('rejects five Java tanks before starting any language worker', async () => {
    const tanks=[1,2,3,4,5].map(tankId=>({tankId,language:'java',source:'source'}));
    await expect(createMixedTankScriptBattleRunner(tanks,new Set([1,2,3,4,5]))).rejects.toThrow('at most 4 Java tanks');
    expect(createJavaTankRunner).not.toHaveBeenCalled();
    expect(createPythonTankRunner).not.toHaveBeenCalled();
    expect(createTankScriptBattleRunner).not.toHaveBeenCalled();
  });
  test('cancellation during initialization disposes a late Java runner and never starts the next tank', async () => {
    const controller = new AbortController();
    let finish;
    createJavaTankRunner.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = createMixedTankScriptBattleRunner([1,2].map(tankId => ({tankId,language:'java',source:'source'})),new Set([1,2]),{signal:controller.signal});
    while (!finish) await Promise.resolve();
    controller.abort();finish(java);
    await expect(pending).rejects.toMatchObject({code:'DISPOSED'});
    expect(createJavaTankRunner).toHaveBeenCalledTimes(1);
    expect(java.dispose).toHaveBeenCalledTimes(1);
  });

  test('routes all four languages, preserves caller order and waits for the whole pre-tick batch', async () => {
    const tanks = [...participants, { tankId: 5, language: 'java', source: 'class MyTank {}' }];
    let finish;
    java.runTick.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const runner = await createMixedTankScriptBattleRunner(tanks, new Set([1,2,3,4,5]));
    const snapshots = [5,4,3,2,1].map(tankId => ({ tankId, tankHealth: 3, allTanks: tanks }));
    let resolved = false;
    const pending = runner.runTick(snapshots).then(result => { resolved = true; return result; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(java.runTick).toHaveBeenCalledWith(snapshots[0]);
    finish({ action: 'rotateRight' });
    expect((await pending).results.map(result => result.tankId)).toEqual([5,4,3,2,1]);
    expect(runner.initialization.find(tank => tank.tankId === 5).timings).toEqual(java.timings);
    await runner.dispose();
    expect(java.dispose).toHaveBeenCalledTimes(1);
  });

  test.each([
    new TankScriptCompileError('Java: MyTank.java, line 2: bad syntax'),
    new TankScriptExecutionError('WORKER_TIMEOUT', 'Java initialization timed out'),
  ])('isolates Java initialization failure and continues with healthy tanks: %s', async error => {
    createJavaTankRunner.mockRejectedValueOnce(error);
    const tanks = [{ tankId: 5, language: 'java', source: 'bad' }, { tankId: 6, language: 'java', source: 'good' }];
    const runner = await createMixedTankScriptBattleRunner(tanks, new Set([5,6]));
    for (let tick = 0; tick < 2; tick++) {
      const { results } = await runner.runTick(tanks.map(tank => ({ tankId: tank.tankId, tankHealth: 3 })));
      expect(results[0].error.code).toBe(error instanceof TankScriptCompileError ? 'COMPILE_ERROR' : 'EXECUTION_TIMEOUT');
      expect(results[1].command.action).toBe('rotateRight');
    }
    expect(createJavaTankRunner).toHaveBeenCalledTimes(2);
    await runner.dispose();
  });

  test('isolates Java tick failure, skips dead tanks and releases the healthy peer on disposal', async () => {
    const failed = { ...java, runTick: jest.fn().mockRejectedValue(new TankScriptExecutionError('EXECUTION_TIMEOUT', 'Java timeout')) };
    createJavaTankRunner.mockResolvedValueOnce(failed);
    const tanks = [1,2].map(tankId => ({ tankId, language:'java', source:'source' }));
    const runner = await createMixedTankScriptBattleRunner(tanks, new Set([1,2]));
    const { results } = await runner.runTick([{tankId:1,tankHealth:3},{tankId:2,tankHealth:3}]);
    expect(results[0].error.code).toBe('EXECUTION_TIMEOUT');
    expect(results[1].command.action).toBe('rotateRight');
    await runner.runTick([{tankId:1,tankHealth:0},{tankId:2,tankHealth:3}]);
    expect(failed.runTick).toHaveBeenCalledTimes(1);
    await runner.dispose();
    expect(java.dispose).toHaveBeenCalledTimes(2);
  });
});
describe('mixed-language battle runner', () => {
  test('routes language groups and returns decisions in caller order using the same snapshots', async () => {
    const runner = await createMixedTankScriptBattleRunner(participants, ids);
    expect(createTankScriptBattleRunner).toHaveBeenCalledWith(participants.slice(1, 3), { signal: undefined });
    expect(createPythonTankRunner).toHaveBeenCalledTimes(2);
    const sharedTanks = [];
    const states = [4, 3, 2, 1].map(tankId => ({ tankId, tankHealth: 3, allTanks: sharedTanks }));
    const { results } = await runner.runTick(states);
    expect(results.map(result => result.tankId)).toEqual([4, 3, 2, 1]);
    expect(javascript.runTick.mock.calls[0][0].every(state => state.allTanks === sharedTanks)).toBe(true);
    expect(python.runTick.mock.calls[0][0].allTanks).toBe(sharedTanks);
    await runner.dispose();
    await runner.dispose();
    expect(javascript.dispose).toHaveBeenCalledTimes(1);
    expect(python.dispose).toHaveBeenCalledTimes(2);
  });

  test('contains Python failures and keeps healthy languages running', async () => {
    python.runTick.mockRejectedValueOnce(new TankScriptExecutionError('EXECUTION_TIMEOUT', 'Python timeout'));
    const runner = await createMixedTankScriptBattleRunner(participants, ids);
    const { results } = await runner.runTick([1, 2, 3, 4].map(tankId => ({ tankId, tankHealth: 3 })));
    expect(results[0]).toEqual({ tankId: 1, error: { code: 'EXECUTION_TIMEOUT', message: 'Python timeout' } });
    expect(results.slice(1).every(result => result.command)).toBe(true);
    await runner.dispose();
  });

  test('rejects invalid batches and overlapping requests, then disposes safely', async () => {
    let finish;
    python.runTick.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const runner = await createMixedTankScriptBattleRunner(participants, ids);
    await expect(runner.runTick([{ tankId: 99, tankHealth: 3 }])).rejects.toMatchObject({ code: 'INVALID_BATCH' });
    const pending = runner.runTick([{ tankId: 1, tankHealth: 3 }]);
    await expect(runner.runTick([])).rejects.toMatchObject({ code: 'BUSY' });
    finish({ action: 'shoot' });
    await pending;
    await runner.dispose();
    await expect(runner.runTick([])).rejects.toMatchObject({ code: 'DISPOSED' });
  });

  test('cleans up initialized workers when a later Python tank fails to compile', async () => {
    createPythonTankRunner.mockRejectedValueOnce(new TankScriptCompileError('Python: Line 2: bad syntax'));
    await expect(createMixedTankScriptBattleRunner(participants, ids)).rejects.toThrow('Tank #1: Python: Line 2');
    expect(javascript.dispose).toHaveBeenCalled();
  });

  test('rejects an empty tick after cancellation instead of reviving a disposed battle', async () => {
    const controller = new AbortController();
    const runner = await createMixedTankScriptBattleRunner(participants, ids, { signal: controller.signal });
    controller.abort();
    await expect(runner.runTick([])).rejects.toMatchObject({ code: 'DISPOSED' });
    await runner.dispose();
  });
});
