import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { createPythonTankRunner } from '../../../frontend/src/game/tank-script/python/pythonTankRunner.js';
import { createPythonWorkerSession } from '../../../frontend/src/game/tank-script/python/pythonWorkerSession.js';
import { loadPythonRuntimeAssets } from '../../../frontend/src/game/tank-script/python/pythonRuntimeAssets.js';
import { TankScriptCompileError, TankScriptExecutionError, TankScriptRunnerError } from '../../../frontend/src/game/tank-script/shared/tankScriptRunnerProtocol.js';

jest.mock('../../../frontend/src/game/tank-script/python/pythonWorkerSession.js', () => ({ createPythonWorkerSession: jest.fn() }));
jest.mock('../../../frontend/src/game/tank-script/python/pythonRuntimeAssets.js', () => ({ loadPythonRuntimeAssets: jest.fn() }));
const state = {
  tankId: 1, tankPosition: { x: 1, y: 2 }, tankRotation: 0, tankHealth: 3,
  allTanks: [], allBullets: [], arenaWidth: 8, arenaHeight: 8,
};
let session;
beforeEach(() => {
  session = { request: jest.fn(async (type, fields) => {
    if (type === 'initialize') { await fields; return { initializationMs: 100 }; }
    return { action: 'shoot' };
  }), close: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined) };
  createPythonWorkerSession.mockReset().mockReturnValue(session);
  loadPythonRuntimeAssets.mockReset().mockResolvedValue({ wasm: new ArrayBuffer(4) });
});

describe('Python runner adapter', () => {
  test('initializes once, serializes snapshots, and preserves the original source', async () => {
    const source = 'if tank_health > 0:\n    shoot()';
    const status = jest.fn();
    const runner = await createPythonTankRunner(source, { onStatus: status });
    expect(status).toHaveBeenCalledWith('Loading Python runtime…');
    expect((await session.request.mock.calls[0][1]).source).toBe(source);
    expect(await runner.runTick(state)).toEqual({ action: 'shoot' });
    expect(await runner.runTick(state)).toEqual({ action: 'shoot' });
    expect(loadPythonRuntimeAssets).toHaveBeenCalledTimes(1);
    expect(session.request.mock.calls.filter(([type]) => type === 'initialize')).toHaveLength(1);
    expect(JSON.parse(session.request.mock.calls[1][1].snapshotJSON).tankPosition).toEqual({ x: 1, y: 2 });
    await runner.dispose();
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  test('rejects oversized source before creating a frame or loading Python', async () => {
    await expect(createPythonTankRunner('x'.repeat(100001))).rejects.toMatchObject({ code: 'INVALID_SOURCE' });
    expect(createPythonWorkerSession).not.toHaveBeenCalled();
    expect(loadPythonRuntimeAssets).not.toHaveBeenCalled();
  });

  test('preserves Python syntax and runtime source locations', async () => {
    session.request.mockResolvedValueOnce({ error: { code: 'COMPILE_ERROR', message: 'expected a colon', line: 2, column: 8 } });
    await expect(createPythonTankRunner('if True')).rejects.toBeInstanceOf(TankScriptCompileError);
    expect(session.close).toHaveBeenCalled();
    session.request.mockImplementation(async type => type === 'initialize'
      ? { initializationMs: 1 }
      : { error: { code: 'RUNTIME_ERROR', message: 'ValueError: bad choice', line: 3 } });
    const runner = await createPythonTankRunner('raise ValueError()');
    await expect(runner.runTick(state)).rejects.toMatchObject({ code: 'RUNTIME_ERROR', message: 'Python: Line 3: ValueError: bad choice' });
    await runner.dispose();
  });

  test('disables and closes an unresponsive tank while preserving a specific timeout error', async () => {
    const runner = await createPythonTankRunner('while True: pass');
    session.request.mockRejectedValueOnce(new TankScriptRunnerError('WORKER_TIMEOUT'));
    await expect(runner.runTick(state)).rejects.toBeInstanceOf(TankScriptExecutionError);
    const requests = session.request.mock.calls.length;
    await expect(runner.runTick(state)).rejects.toMatchObject({ code: 'EXECUTION_TIMEOUT' });
    expect(session.request).toHaveBeenCalledTimes(requests);
    expect(session.close).toHaveBeenCalled();
    await runner.dispose();
    await expect(runner.runTick(state)).rejects.toMatchObject({ code: 'DISPOSED' });
  });

  test('validates returned commands and closes a worker that sends an invalid action', async () => {
    const runner = await createPythonTankRunner('shoot()');
    session.request.mockResolvedValueOnce({ action: 'teleport' });
    await expect(runner.runTick(state)).rejects.toMatchObject({ code: 'INVALID_COMMAND' });
    expect(session.close).toHaveBeenCalled();
  });
});
