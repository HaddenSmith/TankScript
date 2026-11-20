import {
  TANK_SCRIPT_PARTICIPANT_ERRORS, TankScriptCompileError, TankScriptExecutionError, TankScriptRunnerError,
  validateBattleStates,
} from './tankScriptRunnerProtocol.js';
import { createPythonTankRunner } from '../python/pythonTankRunner.js';
import { createTankScriptBattleRunner } from './tankScriptWorkerRunner.js';
import { JAVA_DEBUGGER_ENABLED, MAX_JAVA_BATTLE_TANKS } from './tankScriptFeatures.js';

export async function createMixedTankScriptBattleRunner(participants, ids, { signal, onStatus } = {}) {
  const isolatedTanks = participants.filter(tank => tank.language === 'python' || tank.language === 'java');
  const javascriptTanks = participants.filter(tank => tank.language !== 'python' && tank.language !== 'java');
  const isolatedRunners = new Map();
  const initializationErrors = new Map();
  let javascriptRunner;
  let closed = false;
  let busy = false;
  let disposal;

  function dispose() {
    if (disposal) return disposal;
    closed = true;
    disposal = Promise.allSettled([
      javascriptRunner?.dispose(),
      ...Array.from(isolatedRunners.values(), runner => runner.dispose()),
    ]);
    return disposal;
  }

  try {
    if (participants.filter(tank => tank.language === 'java').length > MAX_JAVA_BATTLE_TANKS) {
      throw new TankScriptCompileError(`Experimental battles support at most ${MAX_JAVA_BATTLE_TANKS} Java tanks.`);
    }
    if (!JAVA_DEBUGGER_ENABLED && participants.some(tank => tank.language === 'java')) {
      throw new TankScriptCompileError('Experimental Java is only available in development.');
    }
    if (javascriptTanks.length) {
      javascriptRunner = await createTankScriptBattleRunner(javascriptTanks, { signal });
    }
    // Start one compiler/interpreter at a time to avoid multiplying startup memory.
    for (const tank of isolatedTanks) {
      try {
        const createRunner = tank.language === 'java'
          ? (await import('../java/javaTankRunner.js')).createJavaTankRunner
          : createPythonTankRunner;
        const runner = await createRunner(tank.source, {
          signal,
          onStatus: message => onStatus?.(`Tank #${tank.tankId}: ${message}`),
        });
        if (signal?.aborted) {
          await runner.dispose();
          throw new TankScriptRunnerError('DISPOSED');
        }
        isolatedRunners.set(tank.tankId, runner);
      } catch (error) {
        if (signal?.aborted) throw new TankScriptRunnerError('DISPOSED');
        // Java compilation/constructors run before ticks, but failures still belong to that tank.
        if (tank.language === 'java' && (error instanceof TankScriptCompileError
            || error instanceof TankScriptExecutionError || TANK_SCRIPT_PARTICIPANT_ERRORS.includes(error.code))) {
          let code = error.code;
          if (error instanceof TankScriptCompileError) code = 'COMPILE_ERROR';
          if (code === 'WORKER_TIMEOUT') code = 'EXECUTION_TIMEOUT';
          if (!TANK_SCRIPT_PARTICIPANT_ERRORS.includes(code)) code = 'RUNTIME_ERROR';
          initializationErrors.set(tank.tankId, { code, message: error.message });
          continue;
        }
        if (error instanceof TankScriptCompileError || error instanceof TankScriptExecutionError) {
          error.message = `Tank #${tank.tankId}: ${error.message}`;
        }
        throw error;
      }
    }
    return {
      initialization: participants.map(({ tankId, language }) => (
        language === 'python' || language === 'java'
          ? { tankId, timings: isolatedRunners.get(tankId)?.timings, error: initializationErrors.get(tankId) }
          : javascriptRunner.initialization.find(entry => entry.tankId === tankId)
      )),
      async runTick(states) {
        if (closed || signal?.aborted) throw new TankScriptRunnerError('DISPOSED');
        if (busy) throw new TankScriptRunnerError('BUSY');
        const alive = validateBattleStates(states, ids);
        const isolatedStates = alive.filter(state => isolatedRunners.has(state.tankId) || initializationErrors.has(state.tankId));
        const javascriptStates = alive.filter(state => !isolatedRunners.has(state.tankId) && !initializationErrors.has(state.tankId));
        busy = true;
        try {
          // Every language sees the same pre-tick state; resolve the engine only after all replies.
          const [javascriptResults, isolatedResults] = await Promise.all([
            javascriptRunner ? javascriptRunner.runTick(javascriptStates) : { results: [] },
            Promise.all(isolatedStates.map(async state => {
              if (initializationErrors.has(state.tankId)) {
                return { tankId: state.tankId, error: initializationErrors.get(state.tankId) };
              }
              try {
                const command = await isolatedRunners.get(state.tankId).runTick(state);
                return { tankId: state.tankId, command };
              } catch (error) {
                if (!(error instanceof TankScriptExecutionError) && !TANK_SCRIPT_PARTICIPANT_ERRORS.includes(error.code)) throw error;
                return { tankId: state.tankId, error: { code: error.code, message: error.message } };
              }
            })),
          ]);
          if (closed) throw new TankScriptRunnerError('DISPOSED');
          const results = [...javascriptResults.results, ...isolatedResults];
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
