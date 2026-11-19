import workerSource from './pythonTankWorker.js?raw';
import bootstrap from './pythonTankRuntime.py?raw';
import { createPythonWorkerSession } from './pythonWorkerSession.js';
import {
  TANK_SCRIPT_LIMITS, TankScriptCompileError, TankScriptExecutionError,
  TankScriptRunnerError, serializeTankSnapshot, tankScriptCommand, validateTankSource,
} from '../shared/tankScriptRunnerProtocol.js';

function readPythonError(error) {
  const code = error?.code;
  if (!['COMPILE_ERROR', 'RUNTIME_ERROR', 'EXECUTION_TIMEOUT', 'WORKER_ERROR'].includes(code)) {
    return new TankScriptRunnerError('WORKER_ERROR');
  }
  const detail = typeof error.message === 'string' ? error.message.slice(0, 2000) : '';
  const position = Number.isSafeInteger(error.line) && error.line > 0
    ? `Line ${error.line}${Number.isSafeInteger(error.column) && error.column > 0 ? ', column ' + error.column : ''}: `
    : '';
  const message = 'Python: ' + position + detail;
  if (code === 'COMPILE_ERROR') return new TankScriptCompileError(message);
  return new TankScriptExecutionError(code, message);
}

export async function createPythonTankRunner(source, { signal, onStatus } = {}) {
  validateTankSource(source);
  const session = createPythonWorkerSession(signal);
  onStatus?.('Loading Python runtime…');
  try {
    const fields = import('./pythonRuntimeAssets.js').then(async ({ loadPythonRuntimeAssets }) => ({
      workerSource, bootstrap, source, executionMs: TANK_SCRIPT_LIMITS.executionMs,
      assets: await loadPythonRuntimeAssets(),
    }));
    const initialized = await session.request('initialize', fields, 30_000);
    if (initialized.error) throw readPythonError(initialized.error);
    if (!Number.isFinite(initialized.initializationMs)) throw new TankScriptRunnerError('WORKER_ERROR');
    let unavailableError;
    let disposed = false;
    return {
      timings: { initializationMs: initialized.initializationMs },
      async runTick(state) {
        if (disposed || signal?.aborted) throw new TankScriptRunnerError('DISPOSED');
        if (unavailableError) throw unavailableError;
        try {
          const result = await session.request('runTick', {
            snapshotJSON: serializeTankSnapshot(state),
          }, TANK_SCRIPT_LIMITS.workerRequestMs);
          if (result.error) throw readPythonError(result.error);
          if (!Object.hasOwn(result, 'action')) throw new TankScriptRunnerError('WORKER_ERROR');
          return tankScriptCommand(result.action === null ? undefined : result.action);
        } catch (error) {
          if (error.code === 'WORKER_TIMEOUT') {
            unavailableError = new TankScriptExecutionError('EXECUTION_TIMEOUT',
              'Python did not respond in time. This tank is disabled until the battle restarts.');
          } else if (error.code === 'WORKER_ERROR') {
            unavailableError = new TankScriptExecutionError('WORKER_ERROR',
              'The Python worker failed. This tank is disabled until the battle restarts.');
          } else if (error.code === 'INVALID_COMMAND') {
            unavailableError = new TankScriptExecutionError('INVALID_COMMAND',
              'Python returned an unsupported command. This tank is disabled until the battle restarts.');
          }
          if (unavailableError) session.close();
          throw unavailableError ?? error;
        }
      },
      dispose() {
        disposed = true;
        return session.dispose();
      },
    };
  } catch (error) {
    session.close();
    if (!(error instanceof TankScriptExecutionError) && error.code === 'WORKER_TIMEOUT') {
      throw new TankScriptExecutionError('WORKER_TIMEOUT',
        'Python initialization took too long. Check the connection and try again.');
    }
    if (!(error instanceof TankScriptExecutionError) && error.code === 'WORKER_ERROR') {
      throw new TankScriptExecutionError('WORKER_ERROR',
        'The Python runtime could not load. Check the connection and try again.');
    }
    throw error;
  }
}
