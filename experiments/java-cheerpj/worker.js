/* global EXPERIMENT_CONFIG, cheerpjInit, cheerpjRunLibrary */
// Loaded from the official CDN in the browser. No proprietary runtime is stored here.
const config = EXPERIMENT_CONFIG;
const start = performance.now();
let bridge;
let busy = false;
const status = message => postMessage({ status: message, elapsedMs: performance.now() - start });
const send = message => postMessage(message);

async function describeError(error) {
  if (error instanceof Error) return error.stack ?? error.message;
  try { if (typeof error?.getMessage === 'function') return await error.getMessage(); } catch {}
  try { return String(error); } catch { return 'Java exception (could not format its message)'; }
}

async function browserProbe() {
  const result = { origin: self.origin, documentAvailable: typeof document !== 'undefined', localStorageAvailable: typeof localStorage !== 'undefined' };
  try {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('poc-account');
      request.onupgradeneeded = () => request.result.createObjectStore('account');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    result.indexedDB = await new Promise((resolve, reject) => {
      const transaction = database.transaction('account');
      const request = transaction.objectStore('account').get('secret');
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
    database.close();
  } catch (error) { result.indexedDBError = error.name; }
  try {
    const response = await fetch(config.appOrigin + '/private/account', { credentials: 'include' });
    result.authenticatedFetch = { status: response.status, body: (await response.text()).slice(0, 300) };
  } catch (error) { result.authenticatedFetchError = error.name; }
  try {
    await fetch(config.appOrigin + '/probe', { method: 'POST', mode: 'no-cors', credentials: 'include', body: 'dummy-java-probe' });
    result.noCorsRequestSent = true;
  } catch (error) { result.noCorsFetchError = error.name; }
  return JSON.stringify(result);
}

async function initialize() {
  try {
    status('Loading CheerpJ 5.0 loader');
    importScripts('https://cjrtnc.leaningtech.com/5.0/loader.js');
    status('Starting Java 21');
    await cheerpjInit({ version: 21, status: 'none', overrideDocumentBase: config.executionOrigin + '/',
      natives: { Java_experiment_ExperimentBridge_browserProbe: async () => browserProbe() } });
    const initializedMs = performance.now() - start;
    // Blob workers cannot resolve /app's relative fetch URLs. /str is the documented in-memory filesystem.
    cheerpOSAddStringFile('/str/bridge.jar', new Uint8Array(config.bridgeBytes));
    status('Opening Java library session');
    const library = await cheerpjRunLibrary('/str/bridge.jar');
    status('Resolving java.lang.System');
    const System = await library.java.lang.System;
    status('Reading Java version');
    const javaVersion = await System.getProperty('java.version');
    status('Loading trusted experiment bridge');
    bridge = await library.experiment.ExperimentBridge;
    send({ ready: true, initializedMs, totalMs: performance.now() - start,
      javaVersion, origin: self.origin,
      resources: performance.getEntriesByType('resource').map(entry => ({ name: entry.name, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, duration: entry.duration })) });
  } catch (error) {
    send({ fatal: true, phase: 'initialize', message: await describeError(error) });
  }
}

onmessage = async ({ data }) => {
  const { id, type } = data;
  if (!Number.isSafeInteger(id)) return;
  if (busy) { send({ id, ok: false, error: 'BUSY' }); return; }
  busy = true;
  const startedAt = performance.now();
  try {
    let result;
    if (type === 'compile') result = JSON.parse(await bridge.compile(data.source));
    else if (type === 'construct') result = await bridge.construct();
    else if (type === 'tick') {
      const { tankId, x, y, health } = data.snapshot;
      result = await bridge.tick(tankId, x, y, health);
    } else if (type === 'probe') result = JSON.parse(await browserProbe());
    else throw new Error('Unknown experiment message');
    send({ id, ok: true, result: result ?? null, elapsedMs: performance.now() - startedAt });
  } catch (error) {
    send({ id, ok: false, error: await describeError(error), elapsedMs: performance.now() - startedAt });
  } finally { busy = false; }
};
initialize();
