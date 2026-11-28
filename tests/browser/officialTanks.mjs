import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { preview } from 'vite';
import { launchChrome } from '../../experiments/java-cheerpj/chrome.mjs';
import { startTankWorkflowFixture } from '../helpers/tankWorkflowFixture.mjs';

// Run after npm run build. Only account/storage requests are fixtures;
// the official catalog, engine, QuickJS, TypeScript compiler and Python workers are real.
const output = new URL('../../coverage/official-browser/', import.meta.url);
const report = { battles: [], checks: [] };
let fixture, server, chrome;
try {
  fixture = await startTankWorkflowFixture();
  await fetch(fixture.origin + '/api/auth/create', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'OfficialTest', email: 'official@example.test', password: 'abcdefg' }) });
  for (const [language, code] of [['typescript', 'const ready: boolean = true; if (ready) shoot();'], ['python', 'shoot()']]) {
    fixture.tanks.set(language, { id: language, name: 'Public ' + language, language, code,
      ownerUsername: 'OfficialTest', color: '#317d84' });
  }
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0, proxy: {
    '/api': { target: fixture.origin }, '/ws': { target: fixture.origin.replace('http:', 'ws:'), ws: true },
  } } });
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  chrome = await launchChrome({ pauseNewTargets: false });
  report.browser = chrome.version.Browser;
  const page = await chrome.newPage(origin + '/battle');
  const evaluate = expression => page.evaluate(expression);
  async function until(expression) {
    for (let attempt = 0; attempt < 1200; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Timed out: ' + expression + '\n' + await evaluate('document.body.innerText.slice(-1800)'));
  }
  const click = text => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === ${JSON.stringify(text)});
    if (!button) throw Error('Missing button: ' + ${JSON.stringify(text)});
    button.click();
  })()`);
  const add = name => evaluate(`document.querySelector('button[aria-label=${JSON.stringify('Add one ' + name)}]').click()`);
  const range = (id, value) => evaluate(`(() => {
    const input = document.getElementById(${JSON.stringify(id)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  const tick = 'Number(document.querySelector(".battle-tick-count")?.textContent.match(/TICK ([0-9]+)/)?.[1])';
  for (const size of [8, 20]) {
    for (const [walls, powerups] of [[false, false], [true, false], [false, true], [true, true]]) {
      await chrome.send('Page.navigate', { url: origin + '/battle' }, page.target.sessionId);
      await until('!!document.querySelector("#enable-powerups")');
      await range('arena-size', size);
      await range('battle-speed', 0);
      for (const name of ['Firefly (Easy)', 'Bloodhound (Medium)', 'Sidewinder (Hard)', 'Prism (Expert)', 'Checkmate (Overkill)']) {
        await add(name);
        if (size === 20) await add(name);
      }
      await until('!!document.querySelector(\'button[aria-label="Add one Public python (OfficialTest)"]\')');
      await add('Public python (OfficialTest)');
      if (size === 20) await add('Public typescript (OfficialTest)');
      if (walls) await evaluate('document.querySelector("#enable-walls").click()');
      if (powerups) await evaluate('document.querySelector("#enable-powerups").click()');
      await click('Start Battle');
      await until(`${tick} >= 25 || document.body.innerText.includes('Battle Results')`);
      if (await evaluate(`document.body.innerText.includes('Pause Battle')`)) await click('Pause Battle');
      const state = await evaluate(`({tick:${tick}, participants:document.querySelectorAll('.battle-participant').length,
        errors:[...document.querySelectorAll('.alert-danger')].map(node=>node.textContent),
        feed:document.querySelector('#realtime-battle-feed').textContent})`);
      assert.ok(state.tick > 0);
      assert.equal(state.participants, size === 20 ? 12 : 6);
      assert.deepEqual(state.errors, []);
      assert.doesNotMatch(state.feed, /timeout|timed out|runtime error|failed|disabled|exceeded|error:/i);
      report.battles.push({ size, walls, powerups, ...state });
      console.log(`PASS: ${size} cells, walls ${walls}, powerups ${powerups}, ${state.tick} ticks`);
      for (const width of [1280, 390]) {
        await chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 }, page.target.sessionId);
        await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
      }
      await click('Reset Battle');
      await until(`${tick} === 0 && document.querySelectorAll('iframe[title="Python execution"]').length === 0`);
    }
  }
  const failures = chrome.errors.filter(error => !(error.method === 'Network.loadingFailed' &&
    (error.canceled || error.errorText === 'net::ERR_ABORTED')));
  assert.deepEqual(failures, []);
  assert.equal(chrome.network.some(resource => resource.status >= 400), false);
  report.checks.push('Eight real Battle page configurations; public mixed languages; reset/frame cleanup; desktop/mobile overflow; no unexpected console/network failures');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = error.stack; console.error(error); process.exitCode = 1;
} finally {
  if (chrome) { report.browserErrors = chrome.errors; await chrome.close(); }
  await server?.close(); await fixture?.close();
  await mkdir(output, { recursive: true });
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
}
