import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { createServer, preview } from 'vite';
import { launchChrome } from '../../experiments/java-cheerpj/chrome.mjs';
import { startTankWorkflowFixture } from '../helpers/tankWorkflowFixture.mjs';

// Run after npm run build. Only accounts/storage use fixtures; Monaco and execution workers are real.
const output = new URL('../../coverage/arena-api-browser/', import.meta.url);
const report = { checks: [], layouts: [] };
const check = name => { report.checks.push(name); console.log('PASS:', name); };
let fixture, server, chrome, page;
try {
  fixture = await startTankWorkflowFixture();
  await fetch(fixture.origin + '/api/auth/create', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ArenaApiTest', email: 'arena@example.test', password: 'abcdefg' }) });
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0, proxy: {
    '/api': { target: fixture.origin }, '/ws': { target: fixture.origin.replace('http:', 'ws:'), ws: true },
  } } });
  chrome = await launchChrome({ pauseNewTargets: false });
  report.browser = chrome.version.Browser;
  page = await chrome.newPage('http://127.0.0.1:' + server.httpServer.address().port + '/tank-editor');
  const evaluate = expression => page.evaluate(expression);
  async function until(expression) {
    for (let attempt = 0; attempt < 1200; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Timed out: ' + expression + '\n' + await evaluate('document.body.innerText.slice(-1800)'));
  }
  const click = text => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw Error('Missing button ' + ${JSON.stringify(text)}); button.click(); })()`);
  const labelClick = label => evaluate(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`);
  const key = (key, code, virtual) => chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtual }, page.target.sessionId)
    .then(() => chrome.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtual }, page.target.sessionId));
  await until('!!document.querySelector("#tank-language")');
  const editorFile = (await readdir(new URL('../../dist/assets/', import.meta.url))).find(name => /^editor\.api-.*\.js$/.test(name));
  await evaluate(`import('/assets/${editorFile}').then(module => window.editorApi = Object.values(module).find(value => value && typeof value.getEditors === 'function'))`);
  async function language(name, id) {
    await evaluate('document.querySelector("#tank-language").click()');
    await evaluate(`[...document.querySelectorAll('[role=option]')].find(node => node.textContent === ${JSON.stringify(name)}).click()`);
    await until(`document.querySelector('[data-mode-id]')?.getAttribute('data-mode-id') === ${JSON.stringify(id)}`);
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  }
  async function code(source) {
    await evaluate(`(() => { const editor = editorApi.getEditors().find(e => e.getDomNode()?.isConnected); const model = editor.getModel(); model.setValue(${JSON.stringify(source)}); editor.setPosition({lineNumber:model.getLineCount(),column:model.getLineMaxColumn(model.getLineCount())}); editor.focus(); })()`);
    await until(`document.querySelector('input[name="tank-code"]').value.replaceAll('\\r\\n','\\n') === ${JSON.stringify(source)}`);
  }
  async function generate() {
    await click('Generate Command');
    await until('!document.querySelector(".debugger-generate-button").disabled');
    return evaluate('document.querySelector(".debugger-command-output").textContent');
  }
  for (const [name, id] of [['JavaScript', 'javascript'], ['TypeScript', 'typescript'], ['Python', 'python']]) {
    await language(name, id);
    // A very long editor line must scroll inside Monaco, never widen the navigation/page.
    await code((id === 'python' ? '# ' : '// ') + 'wide'.repeat(2000));
    await click('API Reference');
    for (const width of [1440, 1280, 768, 390]) {
      await chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 }, page.target.sessionId);
      await evaluate('new Promise(resolve => setTimeout(resolve, 250))');
      const layout = await evaluate(`(() => {
        const state = document.querySelector('.tank-reference-state').getBoundingClientRect();
        const content = document.querySelector('.tank-reference-content').getBoundingClientRect();
        return { scrollWidth:document.documentElement.scrollWidth, width:innerWidth, header:document.querySelector('header').getBoundingClientRect().width,
          stateWidth:state.width, contentWidth:content.width, offenders:[...document.querySelectorAll('body *')].filter(node => node.getBoundingClientRect().right > innerWidth + 1 && node.getBoundingClientRect().height > 0).slice(0,12).map(node => ({tag:node.tagName,classes:String(node.className),width:node.getBoundingClientRect().width})) };
      })()`);
      report.layouts.push({ language: id, viewport: width, ...layout });
      assert.ok(layout.scrollWidth <= width, JSON.stringify(layout));
      assert.ok(layout.header <= width);
      assert.ok(Math.abs(layout.stateWidth - layout.contentWidth) < 2);
      assert.equal(await evaluate(`(() => { const term = document.querySelector('.tank-reference-state dt'); return term.nextElementSibling.getBoundingClientRect().top >= term.getBoundingClientRect().bottom; })()`), true);
      await evaluate('document.querySelector(".tank-reference-state").scrollIntoView({block:"start",behavior:"instant"})');
      await mkdir(output, { recursive: true });
      await writeFile(new URL(`reference-${id}-${width}.png`, output), Buffer.from((await page.screenshot()).data, 'base64'));
    }
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false }, page.target.sessionId);
    await code(id === 'python' ? 'all_wa' : 'allWa');
    await evaluate('editorApi.getEditors().find(e => e.getDomNode()?.isConnected).trigger("keyboard", "editor.action.triggerSuggest", {})');
    await until(`document.querySelector('.suggest-widget.visible')?.textContent.includes(${JSON.stringify(id === 'python' ? 'all_walls' : 'allWalls')})`);
    await key('Escape', 'Escape', 27);
    await code(id === 'python' ? 'all_walls[0].' : 'allWalls[0].');
    await evaluate('editorApi.getEditors().find(e => e.getDomNode()?.isConnected).trigger("keyboard", "editor.action.triggerSuggest", {})');
    await until(`document.querySelector('.suggest-widget.visible')?.textContent.includes(${JSON.stringify(id === 'python' ? 'max_health' : 'maxHealth')})`);
    await key('Escape', 'Escape', 27);
    if (id === 'typescript') {
      await code('allWalls[0].health = 0;');
      await until('editorApi.getModelMarkers({}).some(marker => marker.startLineNumber === 1 && /read-only/.test(marker.message))');
      await click('Debugger');
      assert.match(await generate(), /Line 1.*read-only/s);
      await code('const allWalls: number[] = [1]; const tankBulletSpeed = 99; if (allWalls.length && tankBulletSpeed) shoot();');
      assert.match(await generate(), /"action": "shoot"/);
      await until('editorApi.getModelMarkers({}).filter(marker => marker.severity === 8).length === 0');
    }
    await click('Debugger');
    await click('Reset Scenario');
    for (const [object, x] of [['Heart', 3], ['Lightning', 4], ['Wall', 5]]) {
      await click(object); await labelClick(`Grid square x ${x}, y 2`);
    }
    const source = id === 'python' ? `assert tank_health == tank_max_health == 3
assert tank_bullet_speed == 0.5 and tank_lightning_ticks_remaining == 0
assert len(all_walls) == 1 and (all_walls[0].x, all_walls[0].y, all_walls[0].health, all_walls[0].max_health) == (5, 2, 10, 10)
assert [(p.type, p.x, p.y) for p in all_powerups] == [('heart', 3, 2), ('lightning', 4, 2)]
assert isinstance(all_walls, tuple) and isinstance(all_powerups, tuple)
shoot()
move_right()` : `${id === 'typescript' ? 'const wall: Readonly<TankScriptWall> = allWalls[0];' : 'const wall = allWalls[0];'}
if (tankHealth !== 3 || tankMaxHealth !== 3 || tankBulletSpeed !== 0.5 || tankLightningTicksRemaining !== 0) throw Error('status');
if (allWalls.length !== 1 || wall.x !== 5 || wall.y !== 2 || wall.health !== 10 || wall.maxHealth !== 10) throw Error('walls');
if (allPowerups.length !== 2 || allPowerups[0].type !== 'heart' || allPowerups[1].type !== 'lightning') throw Error('pickups');
if (![allWalls, wall, allPowerups, ...allPowerups].every(Object.isFrozen)) throw Error('mutable');
shoot(); moveRight();`;
    await code(source);
    for (let attempt = 0; attempt < 3; attempt++) assert.match(await generate(), /"action": "shoot"/);
    assert.equal(await evaluate('document.querySelectorAll(".debugger-powerup-target").length'), 2);
    assert.equal(await evaluate('document.querySelectorAll(".debugger-wall-target").length'), 1);
    assert.ok(await evaluate('!!document.querySelector(\'button[aria-label*="Your tank, Your Tank, x 1, y 1"]\')'));
    check(`${name}: API completions, static Debugger information, repeated commands, first-action rule and responsive reference`);
  }
  await click('Reset Scenario');
  await until('document.querySelectorAll(\'iframe[title="Python execution"]\').length === 0');
  assert.equal(await evaluate('[...document.querySelectorAll("[role=option]")].some(node => node.textContent === "Java")'), false);
  report.unexpectedBrowserErrors = chrome.errors.filter(error =>
    !(error.text?.includes("Cannot assign to 'health' because it is a read-only property.")) &&
    !(error.method === 'Network.loadingFailed' && (error.canceled || error.errorText === 'net::ERR_ABORTED')));
  assert.deepEqual(report.unexpectedBrowserErrors, []);
  await server.close();
  server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  // Run the forced-termination lab without attaching an inspector to its busy workers.
  await chrome.send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }, page.target.sessionId);
  await chrome.send('Page.navigate', { url: 'http://127.0.0.1:' + server.httpServer.address().port + '/tests/browser/python-runner.html' }, page.target.sessionId);
  await until(`(() => { try { return JSON.parse(document.querySelector('#results').textContent).status !== 'RUNNING'; } catch { return false; } })()`);
  report.pythonSecurity = await evaluate('JSON.parse(document.querySelector("#results").textContent)');
  assert.equal(report.pythonSecurity.status, 'PASS', JSON.stringify(report.pythonSecurity));
  check('Development runner regressions: opaque origin/CSP, hard timeout, healthy peers, mixed languages, cancellation and cleanup');
  assert.equal(chrome.errors.some(error => /React error|Minified React error|Maximum update depth|Each child in a list/.test(error.text ?? '')), false);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = error.stack; console.error(error); process.exitCode = 1;
} finally {
  if (chrome) { report.browserErrors = chrome.errors; await chrome.close(); }
  await server?.close(); await fixture?.close();
  await mkdir(output, { recursive: true });
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
}
