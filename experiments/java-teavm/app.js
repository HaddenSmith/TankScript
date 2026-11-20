import { createSession, loadAssets } from './session.js';
import * as tanks from './tanks.js';

const snapshot = { tankId: 1, x: 2, y: 3, health: 3 };
let compiler;
let actor;
let generation = 0;
const output = document.querySelector('#output');
const tick = document.querySelector('#tick');
const compileButton = document.querySelector('#compile');
const heartbeat = { ticks: 0, maxLagMs: 0 };
let lastBeat = performance.now();
setInterval(() => {
  const now = performance.now(); heartbeat.maxLagMs = Math.max(heartbeat.maxLagMs, now - lastBeat - 50); lastBeat = now; heartbeat.ticks++;
  document.querySelector('#heartbeat').textContent = 'Page responsive · ' + heartbeat.ticks;
}, 50);
const seeded = (async () => {
  localStorage.setItem('teavm_account', 'dummy-local-storage-secret');
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('teavm-account', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('account');
    request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
  });
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('account', 'readwrite');
    transaction.objectStore('account').put('dummy-indexeddb-secret', 'secret');
    transaction.oncomplete = resolve; transaction.onerror = reject;
  }); database.close();
})();
document.querySelector('#source').value = tanks.starter;
compileButton.onclick = async () => {
  const current = ++generation; tick.disabled = true; compileButton.disabled = true; output.textContent = 'Loading compiler and compiling Java…';
  try {
    await actor?.dispose(); actor = undefined;
    if (!compiler) {
      const created = await createSession();
      if (generation !== current) { await created.dispose(); return; }
      compiler = created;
      await compiler.ready;
    }
    if (generation !== current) return;
    const compiled = await compiler.compile(document.querySelector('#source').value);
    if (generation !== current) return;
    if (!compiled.ok || !compiled.result.successful) { output.textContent = JSON.stringify(compiled, null, 2); return; }
    const created = await createSession({ role: 'runtime' });
    if (generation !== current) { await created.dispose(); return; }
    actor = created;
    const loaded = await actor.load(compiled.result.wasm);
    if (!loaded.ok) throw new Error(loaded.message);
    const constructed = await actor.construct();
    if (!constructed.ok) throw new Error(constructed.message);
    if (generation !== current) { await actor.dispose(); return; }
    output.textContent = 'Compiled in ' + compiled.elapsedMs.toFixed(1) + ' ms. Ready for ticks.'; tick.disabled = false;
  } catch (error) { if (generation === current) output.textContent = error.message; }
  finally { if (generation === current) compileButton.disabled = false; }
};
tick.onclick = async () => {
  try { output.textContent = JSON.stringify(await actor.runTick(snapshot), null, 2); }
  catch (error) { output.textContent = error.message; tick.disabled = true; }
};
document.querySelector('#stop').onclick = async () => {
  generation++; tick.disabled = true; compileButton.disabled = false;
  await Promise.all([actor?.dispose(), compiler?.dispose()]); actor = undefined; compiler = undefined; output.textContent = 'Workers stopped.';
};
window.teavmExperiment = { createSession, loadAssets, tanks, snapshot, heartbeat, seeded };
