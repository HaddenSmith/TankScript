import { createJavaSession } from './supervisor.js';
import * as tanks from './tanks.js';

const output = document.querySelector('#output');
const source = document.querySelector('#source');
source.value = tanks.starter;
let session;
let beats = 0;
let maximumLagMs = 0;
let lastBeat = performance.now();
setInterval(() => {
  const now = performance.now();
  maximumLagMs = Math.max(maximumLagMs, now - lastBeat - 50);
  lastBeat = now;
  document.querySelector('#heartbeat').textContent = `Main-page heartbeat: ${++beats} · largest delay ${Math.round(maximumLagMs)} ms`;
}, 50);
const show = value => { output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
localStorage.setItem('poc_account', 'dummy-local-storage-secret');
const seeded = new Promise((resolve, reject) => {
  const request = indexedDB.open('poc-account');
  request.onupgradeneeded = () => request.result.createObjectStore('account');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const database = request.result;
    const transaction = database.transaction('account', 'readwrite');
    transaction.objectStore('account').put('dummy-indexeddb-secret', 'secret');
    transaction.oncomplete = () => { database.close(); resolve(); };
  };
});

document.querySelector('#start').onclick = async () => {
  document.querySelector('#start').disabled = true;
  document.querySelector('#compile').disabled = true;
  document.querySelector('#tick').disabled = true;
  await session?.dispose();
  session = await createJavaSession({ mode: document.querySelector('#mode').value,
    allowEval: document.querySelector('#allow-eval').checked, onStatus: show });
  const startedSession = session;
  document.querySelector('#stop').disabled = false;
  try {
    const ready = await startedSession.ready;
    if (session === startedSession) {
      const { resources, ...summary } = ready;
      show(summary);
      document.querySelector('#compile').disabled = false;
    }
  } catch (error) { if (session === startedSession) show(error.message); }
  finally { if (session === startedSession) document.querySelector('#start').disabled = false; }
};
document.querySelector('#stop').onclick = async () => {
  await session?.dispose();
  for (const id of ['stop', 'compile', 'tick']) document.querySelector('#' + id).disabled = true;
  show('Worker stopped.');
};
document.querySelector('#compile').onclick = async () => {
  document.querySelector('#tick').disabled = true;
  try {
    const result = await session.compile(source.value);
    show(result);
    if (result.ok && result.result.successful) {
      const initialized = await session.construct();
      if (!initialized.ok) return show(initialized);
      document.querySelector('#tick').disabled = false;
    }
  } catch (error) { show(error.message); }
};
document.querySelector('#tick').onclick = async () => {
  try { show(await session.runTick({ tankId: 1, x: 2, y: 3, health: 3 })); }
  catch (error) { show(error.message); }
};
window.javaExperiment = { createJavaSession, tanks, seeded, get heartbeat() { return { beats, maximumLagMs }; } };
addEventListener('pagehide', () => session?.dispose());
