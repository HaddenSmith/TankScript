import loaderSource from 'pyodide/pyodide.mjs?raw';
import moduleSource from 'pyodide/pyodide.asm.mjs?raw';
import wasmURL from 'pyodide/pyodide.asm.wasm?url';
import stdLibURL from 'pyodide/python_stdlib.zip?url&inline';
import lockFileContents from 'pyodide/pyodide-lock.json';

let wasmDownload;

export async function loadPythonRuntimeAssets() {
  wasmDownload ??= fetch(wasmURL).then(async (response) => {
    if (!response.ok) throw new Error('Could not download the Python runtime.');
    return response.arrayBuffer();
  }).catch((error) => {
    wasmDownload = undefined;
    throw error;
  });
  const wasm = await wasmDownload;
  return {
    loaderSource,
    moduleSource,
    stdLibURL,
    lockFileContents,
    indexURL: new URL('.', new URL(wasmURL, location.href)).href,
    // Transfer a copy; retain the downloaded bytes for other tanks and restarts.
    wasm: wasm.slice(0),
  };
}
