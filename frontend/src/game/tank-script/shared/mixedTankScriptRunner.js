import {
  TankScriptCompileError, TankScriptExecutionError, TankScriptRunnerError,
  validateBattleStates,
} from './tankScriptRunnerProtocol.js';
import { createPythonTankRunner } from '../python/pythonTankRunner.js';
import { createTankScriptBattleRunner } from './tankScriptWorkerRunner.js';

export async function createMixedTankScriptBattleRunner(participants, ids, { signal, onStatus } = {}) {
  const pythonTanks = participants.filter(tank => tank.language === 'python');
  const javascriptTanks = participants.filter(tank => tank.language !== 'python');
  const pythonRunners = new Map();
  let javascriptRunner;
  let closed = false;
  let busy = false;
  let disposal;

  function dispose() {
    if (disposal) return disposal;
    closed = true;
    disposal = Promise.allSettled([
      javascriptRunner?.dispose(),
      ...Array.from(pythonRunners.values(), runner => runner.dispose()),
    ]);
    return disposal;
  }

  try {
    if (javascriptTanks.length) {
      javascriptRunner = await createTankScriptBattleRunner(javascriptTanks, { signal });
    }
    for (const tank of pythonTanks) {
      try {
        const runner = await createPythonTankRunner(tank.source, {
          signal,
          onStatus: () => onStatus?.(`Loading Python runtime for tank #${tank.tankId}…`),
        });
        pythonRunners.set(tank.tankId, runner);
      } catch (error) {
        if (error instanceof TankScriptCompileError || error instanceof TankScriptExecutionError) {
          error.message = `Tank #${tank.tankId}: ${error.message}`;
        }
        throw error;
      }
    }
    return {
      initialization: participants.map(({ tankId, language }) => (
        language === 'python'
          ? { tankId, timings: pythonRunners.get(tankId).timings }
          : javascriptRunner.initialization.find(entry => entry.tankId === tankId)
      )),
      async runTick(states) {
        if (closed || signal?.aborted) throw new TankScriptRunnerError('DISPOSED');
        if (busy) throw new TankScriptRunnerError('BUSY');
        const alive = validateBattleStates(states, ids);
        const pythonStates = alive.filter(state => pythonRunners.has(state.tankId));
        const javascriptStates = alive.filter(state => !pythonRunners.has(state.tankId));
        busy = true;
        try {
          // Every language sees the same pre-tick state; resolve the engine only after all replies.
          const [javascriptResults, pythonResults] = await Promise.all([
            javascriptRunner ? javascriptRunner.runTick(javascriptStates) : { results: [] },
            Promise.all(pythonStates.map(async state => {
              try {
                const command = await pythonRunners.get(state.tankId).runTick(state);
                return { tankId: state.tankId, command };
              } catch (error) {
                if (!(error instanceof TankScriptExecutionError)) throw error;
                return { tankId: state.tankId, error: { code: error.code, message: error.message } };
              }
            })),
          ]);
          if (closed) throw new TankScriptRunnerError('DISPOSED');
          const results = [...javascriptResults.results, ...pythonResults];
          return { results: alive.map(state => results.find(result => result.tankId === state.tankId)) };
        } finally {
          busy = false;
        }
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
