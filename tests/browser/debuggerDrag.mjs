import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { preview } from 'vite';
import { launchChrome } from '../../experiments/java-cheerpj/chrome.mjs';
import { startTankWorkflowFixture } from '../helpers/tankWorkflowFixture.mjs';

// Run after npm run build: node tests/browser/debuggerDrag.mjs
// Native Chromium mouse drags, mobile touch taps and keyboard events; local API fixtures.
const output = new URL('../../coverage/debugger-drag-browser/', import.meta.url);
const report = { checks: [], measuredAt: new Date().toISOString() };
const check = name => { report.checks.push(name); console.log('PASS:', name); };
let fixture, server, chrome, page;
try {
  fixture = await startTankWorkflowFixture();
  await fetch(fixture.origin + '/api/auth/create', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'DragTest', email: 'drag@example.test', password: 'abcdefg' }) });
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0, proxy: {
    '/api': { target: fixture.origin }, '/ws': { target: fixture.origin.replace('http:', 'ws:'), ws: true },
  } } });
  chrome = await launchChrome({ pauseNewTargets: false });
  report.browser = chrome.version.Browser;
  page = await chrome.newPage('http://127.0.0.1:' + server.httpServer.address().port + '/tank-editor');
  const evaluate = expression => page.evaluate(expression);
  const send = (method, params) => chrome.send(method, params, page.target.sessionId);
  async function until(expression) {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Timed out: ' + expression + '\n' + await evaluate('document.body.innerText.slice(-1500)'));
  }
  const palette = name => `[...document.querySelectorAll('.debugger-palette-item')].find(button => button.textContent.trim() === ${JSON.stringify(name)})`;
  const target = label => `document.querySelector('button[aria-label=${JSON.stringify(label)}]')`;
  const objectLabel = (name, x, y) => `${name}, x ${x}, y ${y}${name === 'Wall' ? ', health 10' : ''}`;
  const grid = (x, y) => target(`Grid square x ${x}, y ${y}`);
  async function point(expression, scroll = false) {
    if (scroll) {
      await evaluate(`${expression}.scrollIntoView({behavior:'instant',block:'center'})`);
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    }
    return evaluate(`(() => { const bounds = ${expression}.getBoundingClientRect(); return {x:bounds.left + bounds.width / 2,y:bounds.top + bounds.height / 2}; })()`);
  }
  async function click(expression) {
    const position = await point(expression, true);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...position });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...position });
  }
  async function tap(expression) {
    const position = await point(expression, true);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...position, id: 0, radiusX: 1, radiusY: 1, force: 1 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function key(key, code, windowsVirtualKeyCode) {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  }
  async function drag(source, destination, valid) {
    await evaluate('window.lastNativeDrag = null');
    // Keep palette and arena together in the desktop viewport.
    await evaluate('document.querySelector(".debugger-arena").scrollIntoView({behavior:"instant",block:"center"})');
    const start = await point(source);
    const end = await point(destination);
    await send('Input.setInterceptDrags', { enabled: true });
    try {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...start });
      for (let step = 1; step <= 5; step++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1,
          x: start.x + (end.x - start.x) * step / 5, y: start.y + (end.y - start.y) * step / 5 });
      }
      await until('!!window.lastNativeDrag');
      const native = await evaluate('window.lastNativeDrag');
      assert.equal(native.trusted, true);
      assert.ok(native.payload);
      const data = { items: [{ mimeType: 'application/x-tankscript-object', data: native.payload }], dragOperationsMask: 16 };
      await send('Input.dispatchDragEvent', { type: 'dragEnter', ...end, data });
      await send('Input.dispatchDragEvent', { type: 'dragOver', ...end, data });
      await until(`!!document.querySelector('.is-drop-target') === ${valid}`);
      await send('Input.dispatchDragEvent', { type: 'drop', ...end, data });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...end });
      await until('!document.querySelector(".debugger-drag-image")');
    } finally {
      await send('Input.setInterceptDrags', { enabled: false });
    }
  }

  await until('!!document.querySelector("#tank-language")');
  await evaluate('document.querySelector("#tank-language").click()');
  await evaluate('[...document.querySelectorAll("[role=option]")].find(node => node.textContent === "JavaScript").click()');
  await until('!!document.querySelector(".monaco-editor textarea")');
  await evaluate('[...document.querySelectorAll("[role=tab]")].find(node => node.textContent === "Debugger").click()');
  await until('!!document.querySelector(".debugger-arena")');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.addEventListener('dragstart', event => {
    window.lastNativeDrag = {trusted:event.isTrusted,payload:event.dataTransfer.getData('application/x-tankscript-object')};
  });`);
  for (const name of ['Wall', 'Heart', 'Lightning']) {
    await drag(palette(name), grid(3, 2), true);
    await until(`!!${target(objectLabel(name, 3, 2))}`);
    await drag(palette(name), grid(3, 2), false);
    assert.ok(await evaluate(`!!${target(objectLabel(name, 3, 2))}`));
    await drag(target(objectLabel(name, 3, 2)), grid(4, 3), true);
    await until(`!!${target(objectLabel(name, 4, 3))}`);
    await drag(target(objectLabel(name, 4, 3)), grid(1, 1), false);
    assert.ok(await evaluate(`!!${target(objectLabel(name, 4, 3))}`));
    await click(target(objectLabel(name, 4, 3)));
    await until('document.querySelector(".debugger-inspector-code").textContent.includes("x: 4")');
    await key('ArrowRight', 'ArrowRight', 39);
    await until(`!!${target(objectLabel(name, 5, 3))}`);
    await key('Delete', 'Delete', 46);
    await until(`!${target(objectLabel(name, 5, 3))}`);
    await click(palette(name));
    await click(grid(2, 3));
    await until(`!!${target(objectLabel(name, 2, 3))}`);
    await click(target(objectLabel(name, 2, 3)));
    await until(`!${target(objectLabel(name, 2, 3))}`);
    check(`${name}: trusted native drag from palette, reposition, occupied-drop rejection, inspection, arrows, deletion and click toggling`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  for (const [name, x] of [['Wall', 3], ['Heart', 4], ['Lightning', 5]]) {
    await tap(palette(name));
    await tap(grid(x, 2));
    await until(`!!${target(objectLabel(name, x, 2))}`);
    await tap(target(objectLabel(name, x, 2)));
    await until(`!${target(objectLabel(name, x, 2))}`);
    // Tapping a tank with the selected tool must keep its occupied cell intact.
    await tap(target('Your tank, Your Tank, x 1, y 1, rotation 0, health 3'));
    await until('!!document.querySelector(".debugger-placement-message")');
    assert.equal(await evaluate(`document.querySelectorAll('.debugger-${name === 'Wall' ? 'wall' : 'powerup'}-target').length`), 0);
  }
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
  await mkdir(output, { recursive: true });
  await evaluate('document.querySelector(".debugger-arena").scrollIntoView({behavior:"instant",block:"center"})');
  await writeFile(new URL('mobile.png', output), Buffer.from((await page.screenshot()).data, 'base64'));
  check('Mobile touch taps preserve placement/removal and overlap prevention without horizontal overflow');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = error.stack; console.error(error); process.exitCode = 1;
} finally {
  if (chrome) { report.browserErrors = chrome.errors; await chrome.close(); }
  await server?.close(); await fixture?.close();
  await mkdir(output, { recursive: true });
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
}
