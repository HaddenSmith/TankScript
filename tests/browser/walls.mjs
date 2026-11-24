import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { preview } from 'vite';
import { launchChrome } from '../../experiments/java-cheerpj/chrome.mjs';
import { startTankWorkflowFixture } from '../helpers/tankWorkflowFixture.mjs';

// Run after npm run build: node tests/browser/walls.mjs
// Uses local API fixtures; all three guest runtimes and the BattleEngine are real.
const output = new URL('../../coverage/walls-browser/', import.meta.url);
const report = { checks: [], measuredAt: new Date().toISOString() };
const check = name => { report.checks.push(name); console.log('PASS:', name); };
let fixture, server, chrome, page;
try {
  fixture = await startTankWorkflowFixture();
  await fetch(fixture.origin + '/api/auth/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'WallTest', email: 'wall@example.test', password: 'abcdefg' }),
  });
  for (const [language, code] of [
    ['javascript', 'shoot();'],
    ['typescript', 'const ready: boolean = true; if (ready) shoot();'],
    ['python', 'shoot()'],
  ]) fixture.tanks.set(language, { id: language, name: language, code, language, ownerUsername: 'WallTest', color: '#317d84' });
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0, proxy: {
    '/api': { target: fixture.origin }, '/ws': { target: fixture.origin.replace('http:', 'ws:'), ws: true },
  } } });
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  chrome = await launchChrome({ pauseNewTargets: false });
  report.browser = chrome.version.Browser;
  page = await chrome.newPage(origin + '/battle');
  const evaluate = expression => page.evaluate(expression);
  async function until(expression) {
    for (let attempt = 0; attempt < 1200; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Timed out: ' + expression + '\n' + await evaluate('document.body.innerText.slice(-1600)'));
  }
  const click = text => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === ${JSON.stringify(text)});
    if (!button) throw Error('Missing button: ' + ${JSON.stringify(text)});
    button.click();
  })()`);
  const labelClick = label => evaluate(`document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`);
  const tick = 'Number(document.querySelector(".battle-tick-count")?.textContent.match(/TICK (\\d+)/)?.[1])';
  await until('!!document.querySelector("#enable-walls")');
  assert.equal(await evaluate('document.querySelector("#enable-walls").checked'), false);
  for (const language of ['javascript', 'typescript', 'python']) {
    await until(`!!document.querySelector('[aria-label="Add one ${language} (WallTest)"]')`);
    await labelClick(`Add one ${language} (WallTest)`);
  }
  await evaluate('document.querySelector("#enable-walls").click()');
  // Seed only the synchronous wall-generation step, leaving runtime behavior intact.
  await evaluate(`(() => {
    const random = Math.random;
    try { Math.random = () => 0; [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Start Battle').click(); }
    finally { Math.random = random; }
  })()`);
  await until('!!document.querySelector(".battle-wall")');
  report.generatedWalls = await evaluate('document.querySelectorAll(".battle-wall").length');
  await until('!!document.querySelector(".battle-wall--light")');
  await click('Pause Battle');
  for (const width of [1280, 390]) {
    await chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 }, page.target.sessionId);
    await evaluate('document.querySelector(".battle-arena").scrollIntoView({behavior:"instant",block:"center"})');
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
    const positions = await evaluate(`(() => {
      const arena = document.querySelector('.battle-arena').getBoundingClientRect();
      return [...document.querySelectorAll('.battle-wall')].every(wall => {
        const bounds = wall.getBoundingClientRect();
        return bounds.left >= arena.left && bounds.right <= arena.right && bounds.top >= arena.top && bounds.bottom <= arena.bottom;
      });
    })()`);
    assert.ok(positions);
    await mkdir(output, { recursive: true });
    await writeFile(new URL(`battle-${width}.png`, output), Buffer.from((await page.screenshot()).data, 'base64'));
  }
  check('Desktop/mobile arena coordinates and visible damage fit without horizontal overflow');
  await click('Resume Battle');
  await until('!!document.querySelector(".battle-wall--moderate")');
  await until('!!document.querySelector(".battle-wall--heavy")');
  await until(`document.querySelectorAll('.battle-wall').length < ${report.generatedWalls}`);
  assert.equal(await evaluate('!!document.querySelector(".alert-danger")'), false);
  assert.ok(await evaluate(tick + ' >= 10'));
  check('Actual JavaScript/TypeScript/Python battle damages and destroys generated walls');
  await click('Reset Battle');
  await until('document.querySelectorAll(\'iframe[title="Python execution"]\').length === 0');
  assert.equal(await evaluate('document.querySelector("#enable-walls").checked'), true);
  assert.equal(await evaluate('document.querySelectorAll(".battle-wall").length'), 0);
  await click('Start Battle');
  await until('!!document.querySelector(".battle-wall")');
  assert.ok(await evaluate('[...document.querySelectorAll(".battle-wall")].every(wall => wall.title === "Wall: 10 / 10 HP")'));
  await until(tick + ' >= 2');
  await click('Pause Battle');
  assert.ok(await evaluate('document.querySelectorAll(".battle-wall").length > 0'));
  await click('Reset Battle');
  await evaluate('document.querySelector("#enable-walls").click()');
  await click('Start Battle');
  await until(tick + ' >= 2');
  assert.equal(await evaluate('document.querySelectorAll(".battle-wall").length'), 0);
  await click('Reset Battle');
  check('Reset regenerates walls at full health; disabling restores wall-free mixed-language battles');

  await evaluate('fetch("/api/auth/create", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"WallTest",email:"wall@example.test",password:"abcdefg"})})');
  await chrome.send('Page.navigate', { url: origin + '/tank-editor' }, page.target.sessionId);
  await until('!!document.querySelector("#tank-language")');
  await evaluate('document.querySelector("#tank-language").click()');
  await evaluate('[...document.querySelectorAll("[role=option]")].find(node => node.textContent === "JavaScript").click()');
  await until('document.querySelector("[data-mode-id]")?.getAttribute("data-mode-id") === "javascript"');
  const editorFile = (await readdir(new URL('../../dist/assets/', import.meta.url))).find(name => /^editor\.api-.*\.js$/.test(name));
  await evaluate(`import('/assets/${editorFile}').then(module => window.editorApi = Object.values(module).find(value => value && typeof value.getEditors === 'function'))`);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await evaluate('editorApi.getEditors().find(editor => editor.getDomNode()?.isConnected).getModel().setValue("shoot();")');
  await click('Debugger');
  await click('Wall');
  await labelClick('Grid square x 3, y 2');
  await until('!!document.querySelector(\'.debugger-wall-target[aria-label="Wall, x 3, y 2, health 10"]\')');
  await click('Generate Command');
  await until('document.querySelector(".debugger-command-output")?.textContent.includes(\'"action": "shoot"\')');
  assert.ok(await evaluate('document.querySelector(".debugger-inspector-code").textContent.includes("maxHealth: 10")'));
  for (const width of [1280, 390]) {
    await chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 }, page.target.sessionId);
    await evaluate('new Promise(resolve => setTimeout(resolve, 200))');
    await evaluate('document.querySelector(".debugger-arena").scrollIntoView({behavior:"instant",block:"center"})');
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.ok(await evaluate('(() => { const bounds = document.querySelector(".debugger-arena").getBoundingClientRect(); return bounds.height > 0 && bounds.top >= 0 && bounds.bottom <= innerHeight; })()'));
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
    await writeFile(new URL(`debugger-${width}.png`, output), Buffer.from((await page.screenshot()).data, 'base64'));
  }
  await click('Wall');
  await labelClick('Wall, x 3, y 2, health 10');
  assert.equal(await evaluate('document.querySelectorAll(".debugger-wall-target").length'), 0);
  await labelClick('Your tank, Your Tank, x 1, y 1, rotation 0, health 3');
  assert.equal(await evaluate('document.querySelectorAll(".debugger-wall-target").length'), 0);
  assert.match(await evaluate('document.querySelector(".debugger-placement-message").textContent'), /empty grid square/);
  check('Real Debugger places/removes/inspects walls, rejects tank overlap, and still generates a static command');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = error.stack; console.error(error); process.exitCode = 1;
} finally {
  if (chrome) { report.browserErrors = chrome.errors; await chrome.close(); }
  await server?.close(); await fixture?.close();
  await mkdir(output, { recursive: true });
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
}
