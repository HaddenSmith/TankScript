// Trusted classic-worker source, supplied to an opaque frame. The two prefixed
// bindings are the existing host action collector and its action allowlist.
let send;
let compiler;
let runtime;
let api;
let invalidCommand = false;
let busy = false;
let diagnostics = [];
let executionLimitMs;

const allowedImports = {
  env: { memory: 'memory' },
  teavmJso: Object.fromEntries(['defineFunction', 'defineStaticMethod', 'unwrapInt', 'unwrapDouble',
    'createClass', 'wrapInt', 'createFunction1', 'callFunction1', 'isUndefined', 'stringBuiltinsSupported']
    .map(name => [name, 'function'])),
  teavmDate: { currentTimeMillis: 'function' },
  teavmMemory: { notifyHeapResized: 'function', heapOffset: 'global', maxSize: 'global' },
  teavm: Object.fromEntries(['takeStackTrace', 'decorateException', 'createWeakRef', 'deref',
    'createStringWeakRef', 'stringDeref'].map(name => [name, 'function'])),
};

function submitAction(number) {
  if (!api) throw new Error('Java actions can only be submitted during tick().');
  const action = actions[number - 1];
  if (!Number.isInteger(number) || !action) {
    invalidCommand = true;
    throw new Error('Unsupported TankScript action.');
  }
  api[action]();
}

async function loadLibrary(assets, wasm, runtimeOnly) {
  const url = URL.createObjectURL(new Blob([assets['compiler.csp-runtime.js']], { type: 'text/javascript' }));
  try {
    const { load } = await import(url);
    if (!runtimeOnly) return load(wasm, { noAutoImports: true });
    const module = await WebAssembly.compile(wasm, { builtins: ['js-string'] });
    for (const entry of WebAssembly.Module.imports(module)) {
      if (!Object.hasOwn(allowedImports, entry.module) || !Object.hasOwn(allowedImports[entry.module], entry.name)
          || allowedImports[entry.module][entry.name] !== entry.kind) {
        throw new Error('Unsupported Java browser capability: ' + entry.module + '.' + entry.name);
      }
    }
    return load(wasm, { noAutoImports: true, memory: { maxSize: 64 * 1024 * 1024 }, installImports(host) {
      // Exact, static implementations. These strings are matched, never executed.
      host.teavmJso.createFunction1 = (parameter, body) => {
        if (parameter === 'str' && body === 'return str;') return value => value;
        if (parameter === 'action' && body === 'return submitTankScriptAction(action);') return submitAction;
        throw new Error('Unsupported JavaScript interoperability helper.');
      };
      for (const namespace of Object.keys(host)) {
        if (!Object.hasOwn(allowedImports, namespace)) { delete host[namespace]; continue; }
        for (const name of Object.keys(host[namespace])) {
          if (!Object.hasOwn(allowedImports[namespace], name)) delete host[namespace][name];
        }
      }
    } });
  } finally { URL.revokeObjectURL(url); }
}

async function handleRequest({ data }) {
  if (busy) return;
  busy = true;
  const startedAt = performance.now();
  const receivedAt = data.measureTimings ? performance.timeOrigin + startedAt : undefined;
  let executionMs;
  let tickStartedAt;
  try {
    let result;
    if (data.type === 'initializeCompiler') {
      const library = await loadLibrary(data.assets, data.assets['compiler.wasm'], false);
      compiler = library.exports.createCompiler();
      compiler.setSdk(new Int8Array(data.assets['compile-classlib-teavm.bin']));
      compiler.setTeaVMClasslib(new Int8Array(data.assets['runtime-classlib-teavm.bin']));
      compiler.onDiagnostic(error => {
        if (diagnostics.length < 30) diagnostics.push({
          file: String(error.fileName ?? '').slice(0, 200), line: error.lineNumber, column: error.columnNumber,
          severity: error.severity, message: String(error.message).slice(0, 2000),
        });
      });
      result = {};
    } else if (data.type === 'compile') {
      diagnostics = [];
      compiler.clearSourceFiles(); compiler.clearInputClassFiles(); compiler.clearOutputFiles();
      // This pinned browser javac requires basenames even for public packaged SDK sources.
      compiler.addSourceFile('TankScript.java', data.sdk);
      compiler.addSourceFile('TankEntrypoint.java', data.entrypoint);
      compiler.addSourceFile('MyTank.java', data.source);
      const successful = compiler.compile() && await compiler.generateWebAssembly({
        outputName: 'tank', mainClass: 'TankEntrypoint', strictMode: true, obfuscated: false,
      });
      result = successful
        ? { wasm: new Uint8Array(compiler.getWebAssemblyOutputFile('tank.wasm')), compilationMs: performance.now() - startedAt }
        : { error: { code: 'COMPILE_ERROR', message: 'Java could not be compiled.', diagnostics } };
    } else if (data.type === 'initializeRuntime') {
      executionLimitMs = data.executionMs;
      if (!Number.isFinite(executionLimitMs) || executionLimitMs <= 0) throw new Error('Invalid Java execution budget.');
      runtime = await loadLibrary(data.assets, data.wasm, true);
      result = {};
    } else if (data.type === 'construct') {
      runtime.exports.construct();
      executionMs = performance.now() - startedAt;
      result = {};
    } else if (data.type === 'runTick') {
      const state = JSON.parse(data.snapshotJSON);
      const bridge = runtime.exports;
      invalidCommand = false;
      bridge.beginSnapshot(state.tankId, state.tankPosition.x, state.tankPosition.y, state.tankRotation,
        state.tankHealth, state.arenaWidth, state.arenaHeight);
      for (const tank of state.allTanks) bridge.addTank(tank.id, tank.name, tank.x, tank.y, tank.rotation, tank.health);
      for (const bullet of state.allBullets) bridge.addBullet(bullet.id, bullet.ownerId, bullet.x, bullet.y, bullet.rotation);
      api = createTankScriptApi();
      // As in Python, trusted snapshot preparation is outside the player-call budget.
      tickStartedAt = performance.now();
      bridge.tick();
      executionMs = performance.now() - tickStartedAt;
      if (invalidCommand) throw new Error('Unsupported TankScript action.');
      result = { action: api.getSubmittedCommand()?.action ?? null };
    } else throw new Error('Unknown Java worker request.');
    // The external watchdog still bounds preparation, delivery and calls that never return.
    if (executionMs >= executionLimitMs) result = { error: {
      code: 'EXECUTION_TIMEOUT', message: 'Java exceeded its execution time limit. This tank is disabled until restart.',
    } };
    if (data.measureTimings) {
      const finishedAt = performance.now();
      result.timing = { receivedAt, finishedAt: performance.timeOrigin + finishedAt, executionMs,
        snapshotMs: tickStartedAt === undefined ? undefined : tickStartedAt - startedAt,
        tickMs: tickStartedAt === undefined ? undefined : finishedAt - tickStartedAt,
      };
    }
    send({ id: data.id, result });
  } catch (error) {
    if (data.type === 'construct') executionMs = performance.now() - startedAt;
    if (data.type === 'runTick' && tickStartedAt !== undefined) executionMs = performance.now() - tickStartedAt;
    let code = invalidCommand ? 'INVALID_COMMAND' : 'RUNTIME_ERROR';
    let message = String(error.message ?? error).slice(0, 2000);
    if (executionMs >= executionLimitMs) {
      code = 'EXECUTION_TIMEOUT';
      message = 'Java exceeded its execution time limit.';
    }
    const result = { error: { code, message } };
    if (data.measureTimings) result.timing = { receivedAt,
      finishedAt: performance.timeOrigin + performance.now(), executionMs };
    send({ id: data.id, result });
  } finally {
    api = undefined;
    busy = false;
  }
}

// Only the owner frame can supply this private data port. Guest Wasm has no port access.
self.onmessage = event => {
  if (event.data !== 'connect-java-worker' || !event.ports[0] || send) return;
  const port = event.ports[0];
  send = port.postMessage.bind(port);
  port.onmessage = handleRequest;
  port.onmessageerror = () => { throw new Error('Invalid Java worker message.'); };
  send({ workerReady: true });
};
