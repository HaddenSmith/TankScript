let role;
let load;
let compiler;
let runtime;
let compilations = 0;
let diagnostics = [];
let phase;
let runtimeMemory;
const runtimeMemoryLimit = 64 * 1024 * 1024;
const functionBodies = [];
const allowedImports = {
  env: { memory: 'memory' },
  teavmJso: Object.fromEntries(['defineFunction','defineStaticMethod','unwrapInt','unwrapDouble','createClass',
    'wrapInt','createFunction1','callFunction1','stringBuiltinsSupported'].map(name => [name, 'function'])),
  teavmDate: { currentTimeMillis: 'function' },
  teavmMemory: { notifyHeapResized: 'function', heapOffset: 'global', maxSize: 'global' },
  teavm: Object.fromEntries(['takeStackTrace','decorateException','createWeakRef','deref','createStringWeakRef','stringDeref'].map(name => [name, 'function'])),
};

const bridge = `package experiment;
public final class ExperimentBridge {
    public record Snapshot(int tankId, double x, double y, int health) {}
}`;
const entrypoint = `import experiment.ExperimentBridge.Snapshot;
import org.teavm.jso.JSExport;
public final class TankEntrypoint {
    private static MyTank tank;
    @JSExport public static void construct() { tank = new MyTank(); }
    @JSExport public static int tick(int id, double x, double y, int health) {
        String action = tank.tick(new Snapshot(id, x, y, health));
        if (action == null) return 0;
        return switch (action) {
            case "moveUp" -> 1;
            case "moveDown" -> 2;
            case "moveLeft" -> 3;
            case "moveRight" -> 4;
            case "rotateLeft" -> 5;
            case "rotateRight" -> 6;
            case "shoot" -> 7;
            default -> -1;
        };
    }
}`;

async function policyProbe() {
  const stringCode = {};
  const attempts = {
    eval: () => eval('1 + 1'),
    functionConstructor: () => new Function('return 1;'),
    asyncConstructor: () => Object.getPrototypeOf(async function () {}).constructor('return 1;'),
    generatorConstructor: () => Object.getPrototypeOf(function* () {}).constructor('yield 1;'),
  };
  for (const [name, attempt] of Object.entries(attempts)) {
    try { attempt(); stringCode[name] = { allowed: true }; }
    catch (error) { stringCode[name] = { allowed: false, error: error.name }; }
  }
  let wasm;
  try { await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0])); wasm = { allowed: true }; }
  catch (error) { wasm = { allowed: false, error: error.name }; }
  return { stringCode, wasm };
}

async function probe(appOrigin) {
  const result = { origin: self.origin, document: typeof document, localStorage: typeof localStorage,
    cookieStore: typeof cookieStore, caches: typeof caches, indexedDB: typeof indexedDB };
  try {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('teavm-account', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    result.indexedDBOpened = true;
    result.dummyAccountStore = database.objectStoreNames.contains('account');
    database.close();
  } catch (error) { result.indexedDBError = error.name; }
  for (const [name, url, options] of [
    ['privateFetch', appOrigin + '/private/account', { credentials: 'include' }],
    ['blindPost', appOrigin + '/probe', { method: 'POST', credentials: 'include', mode: 'no-cors', body: 'dummy-only' }],
  ]) {
    try { const response = await fetch(url, options); result[name] = { status: response.status }; }
    catch (error) { result[name] = { error: error.name }; }
  }
  result.websocket = await new Promise(resolve => {
    const timer = setTimeout(() => resolve('No open/error event within 1 second'), 1000);
    try {
      const socket = new WebSocket(appOrigin.replace('http:', 'ws:') + '/probe');
      socket.onopen = () => { clearTimeout(timer); socket.close(); resolve('opened'); };
      socket.onerror = () => { clearTimeout(timer); resolve('error'); };
    } catch (error) { clearTimeout(timer); resolve(error.name); }
  });
  try { await navigator.storage.getDirectory(); result.opfs = 'opened'; }
  catch (error) { result.opfs = error.name; }
  return result;
}

onmessage = async ({ data }) => {
  const startedAt = performance.now();
  try {
    if (data.type === 'start') {
      role = data.role;
      const runtimeName = data.loader === 'stock' ? 'compiler.wasm-runtime.js' : 'compiler.csp-runtime.js';
      const runtimeURL = URL.createObjectURL(new Blob([data.assets[runtimeName]], { type: 'text/javascript' }));
      ({ load } = await import(runtimeURL)); URL.revokeObjectURL(runtimeURL);
      if (role === 'compiler') {
        const library = await load(data.assets['compiler.wasm'], { noAutoImports: true });
        compiler = library.exports.createCompiler();
        compiler.setSdk(new Int8Array(data.assets['compile-classlib-teavm.bin']));
        compiler.setTeaVMClasslib(new Int8Array(data.assets['runtime-classlib-teavm.bin']));
        compiler.onDiagnostic(diagnostic => diagnostics.push({ type: diagnostic.type, severity: diagnostic.severity,
          fileName: diagnostic.fileName, lineNumber: diagnostic.lineNumber, columnNumber: diagnostic.columnNumber,
          startPosition: diagnostic.startPosition, endPosition: diagnostic.endPosition, message: diagnostic.message }));
      }
      postMessage({ ready: true, role, loader: data.loader, elapsedMs: performance.now() - startedAt }); return;
    }
    let result;
    if (data.type === 'compile') {
      if (role !== 'compiler') throw new Error('Not a compiler worker');
      diagnostics = [];
      compiler.clearSourceFiles(); compiler.clearInputClassFiles(); compiler.clearOutputFiles();
      // This pinned compiler compares public source names with the basename only.
      compiler.addSourceFile('ExperimentBridge.java', bridge);
      compiler.addSourceFile('TankEntrypoint.java', entrypoint);
      compiler.addSourceFile('MyTank.java', data.source);
      compilations++;
      const javacAt = performance.now();
      phase = 'javac';
      let successful = compiler.compile();
      const javacMs = performance.now() - javacAt;
      const teavmAt = performance.now();
      phase = 'teavm';
      if (successful) successful = await compiler.generateWebAssembly({ outputName: 'tank', mainClass: 'TankEntrypoint', strictMode: true, obfuscated: false });
      const teavmMs = performance.now() - teavmAt;
      const wasm = successful ? new Uint8Array(compiler.getWebAssemblyOutputFile('tank.wasm')) : null;
      result = { successful, diagnostics, compilations, javacMs, teavmMs, wasm,
        outputFiles: successful ? compiler.listWebAssemblyOutputFiles() : [] };
    } else if (data.type === 'load') {
      if (role !== 'runtime') throw new Error('Not a runtime worker');
      const module = await WebAssembly.compile(data.wasm, { builtins: ['js-string'] });
      const imports = WebAssembly.Module.imports(module);
      for (const imported of imports) {
        if (!Object.hasOwn(allowedImports, imported.module) || !Object.hasOwn(allowedImports[imported.module], imported.name)
            || allowedImports[imported.module][imported.name] !== imported.kind) {
          throw new Error('Disallowed Wasm import: ' + imported.module + '.' + imported.name);
        }
      }
      runtime = await load(data.wasm, { noAutoImports: true, memory: { maxSize: runtimeMemoryLimit }, installImports(host) {
        runtimeMemory = host.env.memory;
        // TeaVM uses an identity JSBody helper for strings. Never evaluate guest helper text.
        host.teavmJso.createFunction1 = (parameter, body) => {
          functionBodies.push([parameter, body]);
          if (parameter !== 'str' || body !== 'return str;') throw new Error('Disallowed JavaScript helper capability');
          return value => value;
        };
        for (const namespace of Object.keys(host)) {
          if (!Object.hasOwn(allowedImports, namespace)) { delete host[namespace]; continue; }
          for (const name of Object.keys(host[namespace])) {
            if (!Object.hasOwn(allowedImports[namespace], name)) delete host[namespace][name];
          }
        }
      } });
      result = { imports, functionBodies, exports: Object.keys(runtime.exports), wasmBytes: data.wasm.byteLength,
        linearMemoryBytes: runtimeMemory.buffer.byteLength };
    } else if (data.type === 'construct') {
      runtime.exports.construct(); result = true;
    } else if (data.type === 'tick') {
      const state = data.snapshot;
      const action = runtime.exports.tick(state.tankId, state.x, state.y, state.health);
      if (action < 0 || action > 7) throw new Error('Unsupported Java action');
      result = [null, 'moveUp', 'moveDown', 'moveLeft', 'moveRight', 'rotateLeft', 'rotateRight', 'shoot'][action];
    } else if (data.type === 'probe') result = await probe(data.appOrigin);
    else if (data.type === 'policy') result = await policyProbe();
    else if (data.type === 'memory-limit') {
      const before = runtimeMemory.buffer.byteLength;
      const excessPages = (runtimeMemoryLimit - before) / 65536 + 1;
      let error;
      try { runtimeMemory.grow(excessPages); } catch (failure) { error = failure.name; }
      result = { before, after: runtimeMemory.buffer.byteLength, limit: runtimeMemoryLimit, error };
    }
    else throw new Error('Unknown request');
    postMessage({ id: data.id, ok: true, result, elapsedMs: performance.now() - startedAt });
  } catch (error) {
    const message = String(error.message ?? error);
    if (data.type === 'start') postMessage({ fatal: message });
    else postMessage({ id: data.id, ok: false, message, phase, stack: error.stack, diagnostics, elapsedMs: performance.now() - startedAt });
  }
};
