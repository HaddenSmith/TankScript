import workerSource from './javaTankWorker.js?raw';
import sdk from './TankScript.java?raw';
import entrypoint from './TankEntrypoint.java?raw';
import { createJavaWorkerSession } from './javaWorkerSession.js';
import { loadJavaRuntimeAssets } from './javaRuntimeAssets.js';
import { createTankScriptApi } from '../shared/tankScriptApi.js';
import { JAVA_DEBUGGER_ENABLED, MAX_JAVA_BATTLE_TANKS } from '../shared/tankScriptFeatures.js';
import {
  TANK_SCRIPT_ACTIONS, TANK_SCRIPT_LIMITS, TankScriptCompileError, TankScriptExecutionError,
  TankScriptRunnerError, serializeTankSnapshot, tankScriptCommand, validateTankSource,
} from '../shared/tankScriptRunnerProtocol.js';

const compiledTanks = new Map();
const maxCompiledBytes = 8 * 1024 * 1024;
const compilationStarts = [];
let compiledBytes = 0;
let activeRunners = 0;
let compilerActive = false;

export function getJavaResourceUsage() {
  return { activeRunners, activeCompilers: compilerActive ? 1 : 0,
    cachedPrograms: compiledTanks.size, cachedBytes: compiledBytes };
}
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
  if (compilerActive) throw new TankScriptCompileError('The Java compiler is busy. Wait for it to finish or cancel it, then try again.');
  const now = performance.now();
  while (compilationStarts.length && now - compilationStarts[0] >= 60_000) compilationStarts.shift();
  if (compilationStarts.length >= 8) throw new TankScriptCompileError('Java allows eight new compilations per minute in this tab. Wait a minute and try again.');
  compilationStarts.push(now);
  compilerActive = true;
  const startedAt = performance.now();
  let session;
  try {
    session = createJavaWorkerSession(signal);
    onStatus?.('Loading Java compiler…');
    const initialized = await session.request('initializeCompiler', loadJavaRuntimeAssets().then(assets => ({ workerSource: source, assets })), 30_000);
    if (initialized.error) throw readError(initialized.error);
    const compilerInitializationMs = performance.now() - startedAt;
    onStatus?.('Compiling Java…');
    const result = await session.request('compile', { source: sourceCode, sdk, entrypoint }, 120_000);
    if (result.error) throw readError(result.error);
    if (!(result.wasm instanceof Uint8Array) || !result.wasm.byteLength || result.wasm.buffer.byteLength > maxCompiledBytes
        || !Number.isFinite(result.compilationMs)) {
      throw new TankScriptCompileError('Java compiler returned an invalid or oversized module.');
    }
    while (compiledTanks.size >= 3 || compiledBytes + result.wasm.buffer.byteLength > maxCompiledBytes) {
      const oldest = compiledTanks.keys().next().value;
      compiledBytes -= compiledTanks.get(oldest).wasm.buffer.byteLength;
      compiledTanks.delete(oldest);
    }
    const compiled = { wasm: result.wasm, compilationMs: result.compilationMs, compilerInitializationMs };
    compiledTanks.set(sourceCode, compiled);
    compiledBytes += result.wasm.buffer.byteLength;
    return compiled;
  } finally {
    try { await session?.dispose(); } finally { compilerActive = false; }
  }
}

export async function createJavaTankRunner(sourceCode, { signal, onStatus, measureTimings = false } = {}) {
  if (!JAVA_DEBUGGER_ENABLED) throw new TankScriptCompileError('Experimental Java is only available in development.');
  validateTankSource(sourceCode);
  if (signal?.aborted) throw new TankScriptRunnerError('DISPOSED');
  if (activeRunners >= MAX_JAVA_BATTLE_TANKS) throw new TankScriptCompileError('This tab already has four Java tanks starting or running. Stop them before starting another.');
  activeRunners++;
  let released = false;
  let abortListener;
  function releaseRunner() {
    if (released) return;
    released = true;
    activeRunners--;
    if (abortListener) signal?.removeEventListener('abort', abortListener);
  }
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
    if (signal?.aborted) throw new TankScriptRunnerError('DISPOSED');
    let disposed = false;
    let unavailableError;
    async function dispose() {
      disposed = true;
      try { await session.dispose(); } finally { releaseRunner(); }
    }
    abortListener = () => { void dispose(); };
    signal?.addEventListener('abort', abortListener, { once: true });
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
          try { await session.close(); } finally { releaseRunner(); }
          throw unavailableError;
        }
      },
      dispose,
    };
  } catch (error) {
    try { await session?.close(); } finally { releaseRunner(); }
    if (error.code === 'WORKER_TIMEOUT') throw new TankScriptExecutionError('WORKER_TIMEOUT',
      'Java initialization or compilation exceeded its time limit. Simplify the code and try again.');
    throw error;
  }
}
