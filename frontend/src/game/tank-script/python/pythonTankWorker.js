// This trusted worker source is loaded into the opaque-origin Python frame.
const send = self.postMessage.bind(self);
const nativeFetch = self.fetch.bind(self);
let runPythonTick;
let busy = false;
self.onmessage = async ({ data }) => {
  if (busy) return;
  busy = true;
  const { id, type } = data;
  try {
    let result;
    if (type === 'initialize') {
      const startedAt = performance.now();
      const { assets } = data;
      const wasmURL = new URL('pyodide.asm.wasm', assets.indexURL).href;
      self.fetch = (url, options) => {
        if (String(url) === wasmURL) return Promise.resolve(new Response(assets.wasm, {
          headers: { 'Content-Type': 'application/wasm' },
        }));
        return nativeFetch(url, options);
      };
      const loaderURL = URL.createObjectURL(new Blob([assets.loaderSource], { type: 'text/javascript' }));
      const moduleURL = URL.createObjectURL(new Blob([assets.moduleSource], { type: 'text/javascript' }));
      try {
        const [{ loadPyodide }, { default: createModule }] = await Promise.all([import(loaderURL), import(moduleURL)]);
        const pyodide = await loadPyodide({
          indexURL: assets.indexURL,
          stdLibURL: assets.stdLibURL,
          lockFileContents: assets.lockFileContents,
          jsglobals: Object.create(null),
          enableRunUntilComplete: false,
          stdin: () => null,
          stdout: () => {},
          stderr: () => {},
          // Supply the pinned runtime from memory; the worker cannot fetch the network.
          createPyodideModule: createModule,
        });
        const createRunner = pyodide.runPython(data.bootstrap);
        try {
          runPythonTick = createRunner(data.source, data.executionMs);
        } finally {
          createRunner.destroy();
        }
        result = typeof runPythonTick === 'string'
          ? JSON.parse(runPythonTick)
          : { initializationMs: performance.now() - startedAt };
      } finally {
        self.fetch = nativeFetch;
        URL.revokeObjectURL(loaderURL);
        URL.revokeObjectURL(moduleURL);
      }
    } else if (type === 'runTick' && typeof runPythonTick === 'function') {
      result = JSON.parse(runPythonTick(data.snapshotJSON));
    } else if (type === 'dispose') {
      runPythonTick?.destroy?.();
      runPythonTick = undefined;
      result = {};
    } else {
      throw new Error('Invalid Python worker request.');
    }
    send({ id, result });
  } catch (error) {
    send({ id, result: { error: { code: 'WORKER_ERROR', message: 'The Python runtime could not complete the request: ' + String(error.message).slice(0, 500) } } });
  } finally {
    busy = false;
  }
};
