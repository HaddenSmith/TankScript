import { TankScriptCompileError, validateTankSource } from '../shared/tankScriptRunnerProtocol.js';

const compiledScripts = new Map();
const MAX_CACHED_SCRIPTS = 10;
const COMPILATION_TIMEOUT_MS = 15_000;

function compileInWorker(source, signal) {
  return new Promise((resolve, reject) => {
    let worker;
    let timer;
    function finish(error, javascript) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker?.terminate();
      if (error) reject(error);
      else resolve(javascript);
    }
    function abort() {
      finish(new TankScriptCompileError('TypeScript compilation was cancelled.'));
    }
    if (signal?.aborted) return abort();
    try {
      worker = new Worker(new URL('./typeScriptCompilerWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        if (data?.diagnostics?.length) {
          const messages = data.diagnostics.map(({ line, column, message }) => (
            line ? `Line ${line}, column ${column}: ${message}` : message
          ));
          finish(new TankScriptCompileError('TypeScript: ' + messages.join('\n'), data.diagnostics));
        } else if (typeof data?.javascript === 'string') {
          finish(null, data.javascript);
        } else {
          finish(new TankScriptCompileError('TypeScript compiler returned an invalid result.'));
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(new TankScriptCompileError('TypeScript compiler could not load. Please try again.'));
      };
      worker.onmessageerror = () => finish(new TankScriptCompileError('TypeScript compiler returned an unreadable result.'));
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(new TankScriptCompileError(
        'TypeScript compilation took too long. Simplify the code and try again.',
      )), COMPILATION_TIMEOUT_MS);
      worker.postMessage({ source });
    } catch {
      finish(new TankScriptCompileError('TypeScript compiler could not start. Please try again.'));
    }
  });
}

// Compile at runner startup, never during a battle tick. Cache only successful results.
export async function compileTankScript(source, language = 'javascript', { signal } = {}) {
  validateTankSource(source);
  if (language === 'javascript') return source;
  if (language !== 'typescript') {
    throw new TankScriptCompileError('This tank language is not available yet.');
  }
  if (compiledScripts.has(source)) return compiledScripts.get(source);

  const javascript = await compileInWorker(source, signal);
  validateTankSource(javascript);
  if (compiledScripts.size >= MAX_CACHED_SCRIPTS) {
    compiledScripts.delete(compiledScripts.keys().next().value);
  }
  compiledScripts.set(source, javascript);
  return javascript;
}
