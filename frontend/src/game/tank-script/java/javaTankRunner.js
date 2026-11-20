import workerSource from './javaTankWorker.js?raw';
import sdk from './TankScript.java?raw';
import entrypoint from './TankEntrypoint.java?raw';
import { createJavaWorkerSession } from './javaWorkerSession.js';
import { loadJavaRuntimeAssets } from './javaRuntimeAssets.js';
import { createTankScriptApi } from '../shared/tankScriptApi.js';
import { JAVA_DEBUGGER_ENABLED } from '../shared/tankScriptFeatures.js';
import {
  TANK_SCRIPT_ACTIONS, TANK_SCRIPT_LIMITS, TankScriptCompileError, TankScriptExecutionError,
  TankScriptRunnerError, serializeTankSnapshot, tankScriptCommand, validateTankSource,
} from '../shared/tankScriptRunnerProtocol.js';

const compiledTanks = new Map();
const maxCompiledBytes = 8 * 1024 * 1024;
// Only trusted API source is inserted into the worker. Player source is always message data.
const source = `const createTankScriptApi = ${createTankScriptApi.toString()};\nconst actions = ${JSON.stringify(TANK_SCRIPT_ACTIONS)};\n${workerSource}`;

function readError(error) {
  const message = 'Java: ' + String(error?.message ?? 'The worker failed.').slice(0, 2000);
  if (error?.code === 'COMPILE_ERROR') {
    const diagnostics = error.diagnostics ?? [];
    const details = diagnostics.map(item => `${item.file || 'MyTank.java'}${item.line > 0 ? ', line ' + item.line : ''}${item.column > 0 ? ', column ' + item.column : ''}: ${item.message}`);
    return new TankScriptCompileError(details.length ? 'Java: ' + details.join('\n') : message, diagnostics);
  }
  let code = 'RUNTIME_ERROR';
  if (error?.code === 'INVALID_COMMAND' || error?.code === 'EXECUTION_TIMEOUT') code = error.code;
  return new TankScriptExecutionError(code, message);
}

async function compile(sourceCode, signal, onStatus) {
  if (compiledTanks.has(sourceCode)) return { ...compiledTanks.get(sourceCode), compilationCached: true };
  const startedAt = performance.now();
  const session = createJavaWorkerSession(signal);
  try {
    onStatus?.('Loading Java compiler…');
    const initialized = await session.request('initializeCompiler', loadJavaRuntimeAssets().then(assets => ({ workerSource: source, assets })), 30_000);
    if (initialized.error) throw readError(initialized.error);
    const compilerInitializationMs = performance.now() - startedAt;
    onStatus?.('Compiling Java…');
    const result = await session.request('compile', { source: sourceCode, sdk, entrypoint }, 120_000);
    if (result.error) throw readError(result.error);
    if (!(result.wasm instanceof Uint8Array) || !result.wasm.byteLength || result.wasm.byteLength > maxCompiledBytes
        || !Number.isFinite(result.compilationMs)) {
      throw new TankScriptCompileError('Java compiler returned an invalid or oversized module.');
    }
    if (compiledTanks.size >= 3) compiledTanks.delete(compiledTanks.keys().next().value);
    const compiled = { wasm: result.wasm, compilationMs: result.compilationMs, compilerInitializationMs };
    compiledTanks.set(sourceCode, compiled);
    return compiled;
  } finally { await session.dispose(); }
}

export async function createJavaTankRunner(sourceCode, { signal, onStatus, measureTimings = false } = {}) {
  if (!JAVA_DEBUGGER_ENABLED) throw new TankScriptCompileError('Experimental Java is only available in development.');
  validateTankSource(sourceCode);
  if (signal?.aborted) throw new TankScriptRunnerError('DISPOSED');
  const startedAt = performance.now();
  let session;
  try {
    const compiled = await compile(sourceCode, signal, onStatus);
    if (signal?.aborted) throw new TankScriptRunnerError('DISPOSED');
    const runtimeStartedAt = performance.now();
    onStatus?.('Starting Java tank…');
    session = createJavaWorkerSession(signal, { measureTimings });
    const initialized = await session.request('initializeRuntime', loadJavaRuntimeAssets().then(assets => ({
      workerSource: source, assets: { 'compiler.csp-runtime.js': assets['compiler.csp-runtime.js'] }, wasm: compiled.wasm,
      executionMs: TANK_SCRIPT_LIMITS.executionMs,
    })), TANK_SCRIPT_LIMITS.workerRequestMs);
    if (initialized.error) throw readError(initialized.error);
    // The worker enforces executionMs; the outer watchdog also covers scheduling/delivery.
    const constructed = await session.request('construct', {}, TANK_SCRIPT_LIMITS.workerRequestMs);
    if (constructed.error) throw readError(constructed.error);
    let disposed = false;
    let unavailableError;
    return {
      timings: {
        initializationMs: performance.now() - startedAt,
        compilerInitializationMs: compiled.compilationCached ? 0 : compiled.compilerInitializationMs,
        compilationMs: compiled.compilationCached ? 0 : compiled.compilationMs,
        compilationCached: compiled.compilationCached === true,
        runtimeInitializationMs: performance.now() - runtimeStartedAt,
      },
      getLastRequestTiming() { return session.lastRequest; },
      async runTick(state) {
        if (disposed || signal?.aborted) throw new TankScriptRunnerError('DISPOSED');
        if (unavailableError) throw unavailableError;
        const snapshotJSON = serializeTankSnapshot(state);
        try {
          const result = await session.request('runTick', { snapshotJSON }, TANK_SCRIPT_LIMITS.workerRequestMs);
          if (result.error) throw readError(result.error);
          if (!Object.hasOwn(result, 'action')) throw new TankScriptRunnerError('WORKER_ERROR');
          return tankScriptCommand(result.action === null ? undefined : result.action);
        } catch (error) {
          if (error.code === 'BUSY' || error.code === 'DISPOSED') throw error;
          unavailableError = error;
          if (error.code === 'WORKER_TIMEOUT') unavailableError = new TankScriptExecutionError('EXECUTION_TIMEOUT',
            'Java did not respond within its worker watchdog. This tank is disabled until restart.');
          if (error.code === 'WORKER_ERROR') unavailableError = new TankScriptExecutionError('RUNTIME_ERROR',
            'The Java worker failed. This tank is disabled until restart.');
          await session.close();
          throw unavailableError;
        }
      },
      dispose() { disposed = true; return session.dispose(); },
    };
  } catch (error) {
    await session?.close();
    if (error.code === 'WORKER_TIMEOUT') throw new TankScriptExecutionError('WORKER_TIMEOUT',
      'Java initialization or compilation exceeded its time limit. Simplify the code and try again.');
    throw error;
  }
}
