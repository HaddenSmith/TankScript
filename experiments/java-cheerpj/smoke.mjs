import { mkdir, writeFile } from 'node:fs/promises';
import { startExperiment } from './server.mjs';
import { launchChrome } from './chrome.mjs';
let server;
let chrome;
let page;
const results = [];
try {
  server = await startExperiment();
  chrome = await launchChrome();
  page = await chrome.newPage(server.appOrigin);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await page.evaluate('!!window.javaExperiment')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (process.argv[2] === 'ui') {
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false }, page.target.sessionId);
    async function waitFor(expression, timeoutMs = 120_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await page.evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('UI did not reach expected state: ' + await page.evaluate('document.querySelector("#output").textContent'));
    }
    await page.evaluate('document.querySelector("#start").click()');
    await waitFor('!document.querySelector("#compile").disabled');
    const ready = await page.evaluate('JSON.parse(document.querySelector("#output").textContent)');
    if (!ready.javaVersion.startsWith('21.')) throw new Error('UI did not start Java 21');
    console.log('UI started Java 21');
    await page.evaluate('document.querySelector("#compile").click()');
    await waitFor('!document.querySelector("#tick").disabled');
    const compiled = await page.evaluate('JSON.parse(document.querySelector("#output").textContent)');
    if (!compiled.result.successful || compiled.result.compilations !== 1) throw new Error('UI compilation failed');
    console.log('UI compiled player source in the browser');
    await page.evaluate('document.querySelector("#tick").click()');
    await waitFor('JSON.parse(document.querySelector("#output").textContent).result === "shoot"', 5000);
    const first = await page.evaluate('JSON.parse(document.querySelector("#output").textContent)');
    await page.evaluate('document.querySelector("#tick").click()');
    await waitFor('JSON.parse(document.querySelector("#output").textContent).result === "moveRight"', 5000);
    const second = await page.evaluate('JSON.parse(document.querySelector("#output").textContent)');
    await mkdir(new URL('./results/', import.meta.url), { recursive: true });
    await writeFile(new URL('./results/experiment.png', import.meta.url), Buffer.from((await page.screenshot()).data, 'base64'));
    await page.evaluate('document.querySelector("#stop").click()');
    await waitFor('document.querySelector("#output").textContent === "Worker stopped."', 2000);
    if (await page.evaluate('document.querySelectorAll("iframe").length')) throw new Error('UI did not clean up its frame');
    const ui = { status: 'PASS', javaVersion: ready.javaVersion, compiled, first, second, stopCleanup: true };
    await writeFile(new URL('./results/ui.json', import.meta.url), JSON.stringify(ui, null, 2));
    console.log('UI PASS:', JSON.stringify(ui));
  } else {
  const modes = process.argv[2] === 'isolated' ? [['isolated', true]] : [['opaque', false], ['opaque', true], ['isolated', true]];
  for (const [mode, allowEval] of modes) {
    console.log('Starting', mode, 'JavaScript JIT allowed:', allowEval);
    const progress = setInterval(async () => {
      console.log('Stage:', await page.evaluate('window.__lastStatus ?? null').catch(() => null));
      console.log('Recent resource requests:', JSON.stringify(chrome.network.slice(-3).map(({url,status,encodedBytes}) => ({url,status,encodedBytes}))));
      console.log('Recent runtime errors:', JSON.stringify(chrome.errors.slice(-2)).slice(0,1800));
    }, 10_000);
    const result = await page.evaluate(`(async () => {
      window.__session = await javaExperiment.createJavaSession({ mode: ${JSON.stringify(mode)}, allowEval: ${allowEval}, onStatus: value => { window.__lastStatus = value; } });
      try { return { ok: true, info: await __session.ready }; }
      catch (error) { return { ok: false, error: error.message, lastStatus: window.__lastStatus }; }
    })()`);
    clearInterval(progress);
    console.log(JSON.stringify(result));
    results.push({ mode, allowEval, ...result });
    if (result.ok) {
      for (const expression of [
        '__session.compile(javaExperiment.tanks.starter)', '__session.construct(10000)',
        '__session.runTick({tankId:1,x:2,y:3,health:3}, 10000)',
        '__session.runTick({tankId:1,x:2,y:3,health:3}, 10000)',
      ]) {
        const value = await page.evaluate(expression);
        console.log(expression, JSON.stringify(value));
        results.push({ expression, value });
      }
    }
    await page.evaluate('__session.dispose()');
    if (result.ok) break;
  }
  }
} finally {
  await mkdir(new URL('./results/', import.meta.url), { recursive: true });
  if (process.argv[2] !== 'ui') {
    await writeFile(new URL('./results/smoke.json', import.meta.url), JSON.stringify({ results,
      network: chrome?.network, errors: chrome?.errors, hits: server?.hits }, null, 2));
  }
  await chrome?.close();
  await server?.close();
}
