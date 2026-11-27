import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { preview } from 'vite';
import { launchChrome } from '../../experiments/java-cheerpj/chrome.mjs';
import { startTankWorkflowFixture } from '../helpers/tankWorkflowFixture.mjs';

// Run after npm run build: node tests/browser/powerups.mjs
// Local API fixtures only; the engine, compiler, QuickJS and isolated Python runner are real.
const output = new URL('../../coverage/powerups-browser/', import.meta.url);
const report = { checks: [], battles: [], measuredAt: new Date().toISOString() };
const check = name => { report.checks.push(name); console.log('PASS:', name); };
const script = `if (tankPosition.x === 1 && tankPosition.y === 1) moveUp();
else if (tankPosition.x === 1 && tankPosition.y === 0 && tankHealth === 3) moveUp();
else if (tankPosition.x === 1 && tankPosition.y === 0) moveLeft();
else if (tankPosition.x === 0 && tankPosition.y === 0) moveDown();
else shoot();`;
const python = `if tank_position.x == 1 and tank_position.y == 1:
    move_up()
elif tank_position.x == 1 and tank_position.y == 0 and tank_health == 3:
    move_up()
elif tank_position.x == 1 and tank_position.y == 0:
    move_left()
elif tank_position.x == 0 and tank_position.y == 0:
    move_down()
else:
    shoot()`;
const languages = ['javascript', 'typescript', 'python'];
let fixture, server, chrome, page;
try {
  fixture = await startTankWorkflowFixture();
  await fetch(fixture.origin + '/api/auth/create', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'PowerupTest', email: 'powerups@example.test', password: 'abcdefg' }) });
  for (const language of languages) {
    const collector = language === 'python' ? python : (language === 'typescript' ? 'const ready: boolean = true;\n' : '') + script;
    for (const [role, code] of [['Collector', collector], ['Watcher', language === 'python' ? 'rotate_right()' : 'rotateRight();']]) {
      const id = role + '-' + language;
      fixture.tanks.set(id, { id, name: role + ' ' + language, language, code, ownerUsername: 'PowerupTest', color: '#317d84' });
    }
  }
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
    throw Error('Timed out: ' + expression + '\n' + await evaluate('document.body.innerText.slice(-1800)'));
  }
  const click = text => evaluate(`(() => { const node = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!node) throw Error('Missing button: ' + ${JSON.stringify(text)}); node.click(); })()`);
  const labelClick = label => evaluate(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`);
  const tick = 'Number(document.querySelector(".battle-tick-count")?.textContent.match(/TICK ([0-9]+)/)?.[1])';
  async function screenshot(name, selector, width) {
    await chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 }, page.target.sessionId);
    await evaluate('new Promise(resolve => setTimeout(resolve, 200))');
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({behavior:'instant',block:'center'})`);
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
    assert.ok(await evaluate(`(() => { const bounds = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return bounds.height > 0 && bounds.top >= 0 && bounds.bottom <= innerHeight; })()`));
    if (selector === '.battle-arena') {
      assert.ok(await evaluate(`(() => {
        const arena = document.querySelector('.battle-arena').getBoundingClientRect();
        return [...document.querySelectorAll('.battle-tank__lightning')].every(badge => {
          const bounds = badge.getBoundingClientRect();
          return bounds.left >= arena.left && bounds.right <= arena.right && bounds.top >= arena.top && bounds.bottom <= arena.bottom;
        });
      })()`));
    }
    await mkdir(output, { recursive: true });
    await writeFile(new URL(`${name}-${width}.png`, output), Buffer.from((await page.screenshot()).data, 'base64'));
  }

  for (const language of languages) {
    await chrome.send('Page.navigate', { url: origin + '/battle' }, page.target.sessionId);
    await until('!!document.querySelector("#enable-powerups")');
    assert.equal(await evaluate('document.querySelector("#enable-powerups").checked || document.querySelector("#enable-walls").checked'), false);
    for (const entry of [language, ...languages.filter(item => item !== language)]) {
      const name = `${entry === language ? 'Collector' : 'Watcher'} ${entry}`;
      await until(`!!document.querySelector('[aria-label="Add one ${name} (PowerupTest)"]')`);
      await labelClick(`Add one ${name} (PowerupTest)`);
    }
    await evaluate(`document.querySelector('#enable-walls').click(); document.querySelector('#enable-powerups').click();
      const input = document.querySelector('#battle-speed'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '0'); input.dispatchEvent(new Event('input', {bubbles:true}));`);
    // Seed the host layout generator, leaving guest runtimes and security policies intact.
    await evaluate(`window.originalRandom = Math.random; Math.random = () => 0;
      window.powerupObservations = []; let seenTick = -1;
      window.powerupObserver = new MutationObserver(() => {
        const tick = Number(document.querySelector('.battle-tick-count')?.textContent.match(/TICK ([0-9]+)/)?.[1]);
        const tank = document.querySelector('.battle-tank[aria-label^="Collector"]');
        if (!tank || !Number.isFinite(tick) || tick <= seenTick) return;
        seenTick = tick;
        const wall = document.querySelector('[aria-label^="Wall, x 2, y 1,"]');
        const upgrade = document.querySelector('.battle-participant .battle-lightning-upgrade');
        window.powerupObservations.push({tick, health:Number(tank.getAttribute('aria-label').match(/health ([0-9]+)/)[1]),
          upgraded:!!tank.querySelector('.battle-tank__lightning'), hearts:document.querySelectorAll('.battle-arena .battle-powerup--heart').length,
          remaining:Number(upgrade?.textContent.match(/Lightning: ([0-9]+)/)?.[1] ?? 0),
          lightnings:document.querySelectorAll('.battle-arena .battle-powerup--lightning').length,
          wallHealth:wall ? Number(wall.title.match(/Wall: ([0-9]+)/)[1]) : null});
      }); window.powerupObserver.observe(document.querySelector('.battle-arena-layout'), {subtree:true,childList:true,attributes:true,characterData:true});`);
    await click('Start Battle');
    await until('window.powerupObservations.some(state => state.tick >= 1)');
    await evaluate('Math.random = window.originalRandom');
    await until('window.powerupObservations.some(state => state.tick >= 8)');
    await click('Pause Battle');
    const states = await evaluate('window.powerupObservations');
    assert.deepEqual(states.find(state => state.tick === 1), { tick: 1, health: 3, upgraded: true, hearts: 1, lightnings: 0, wallHealth: 10, remaining: 50 });
    assert.equal(states.find(state => state.tick === 2).health, 2);
    assert.equal(states.find(state => state.tick === 3).health, 3);
    assert.equal(states.find(state => state.tick === 3).hearts, 0);
    assert.equal(states.find(state => state.tick === 5).wallHealth, 10);
    assert.equal(states.find(state => state.tick === 6).wallHealth, 9); // Fast shot hits on its first moving tick.
    assert.ok(states.every(state => state.health <= 3));
    assert.ok(await evaluate('document.querySelector(".battle-participant").textContent.includes("Bullet speed ×2")'));
    const pausedTick = await evaluate(tick);
    const pausedCountdown = await evaluate('document.querySelector(".battle-lightning-upgrade").textContent');
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.equal(await evaluate(tick), pausedTick);
    assert.equal(await evaluate('document.querySelector(".battle-lightning-upgrade").textContent'), pausedCountdown);
    for (const width of [1280, 390]) await screenshot(`battle-${language}`, '.battle-arena', width);
    await click('Resume Battle');
    await until('window.powerupObservations.some(state => state.tick >= 15 && state.wallHealth === null)');
    await until('window.powerupObservations.some(state => state.tick >= 52)');
    await click('Pause Battle');
    const expiredStates = await evaluate('window.powerupObservations');
    assert.equal(expiredStates.find(state => state.tick === 50).remaining, 1);
    assert.equal(expiredStates.find(state => state.tick === 50).upgraded, true);
    assert.equal(expiredStates.find(state => state.tick === 51).remaining, 0);
    assert.equal(expiredStates.find(state => state.tick === 51).upgraded, false);
    assert.equal(await evaluate('document.querySelectorAll(".battle-lightning-upgrade, .battle-tank__lightning").length'), 0);
    report.battles.push({ collector: language, states: await evaluate('window.powerupObservations') });
    assert.equal(await evaluate('!!document.querySelector(".alert-danger")'), false);
    await click('Reset Battle');
    await until('document.querySelectorAll(\'iframe[title="Python execution"]\').length === 0');
    assert.equal(await evaluate('document.querySelectorAll(".battle-powerup, .battle-tank__lightning, .battle-wall").length'), 0);
    assert.equal(await evaluate('document.querySelector("#enable-powerups").checked && document.querySelector("#enable-walls").checked'), true);
    await evaluate('document.querySelector("#enable-powerups").click()');
    await click('Start Battle'); await until(tick + ' >= 2');
    assert.equal(await evaluate('document.querySelectorAll(".battle-powerup, .battle-tank__lightning").length'), 0);
    assert.ok(await evaluate('document.querySelectorAll(".battle-wall").length > 0'));
    await click('Reset Battle');
    await evaluate('document.querySelector("#enable-walls").click()');
    await click('Start Battle'); await until(tick + ' >= 2');
    assert.equal(await evaluate('document.querySelectorAll(".battle-powerup, .battle-wall, .battle-tank__lightning").length'), 0);
    await click('Reset Battle');
    await until('document.querySelectorAll(\'iframe[title="Python execution"]\').length === 0');
    check(`${language} collector: 50-tick lightning, pause/resume, expiration, healing, wall collisions, desktop/mobile and reset cleanup`);
  }

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
  for (const [name, x] of [['Heart', 3], ['Lightning', 4], ['Wall', 5]]) { await click(name); await labelClick(`Grid square x ${x}, y 2`); }
  await click('Generate Command');
  await until('document.querySelector(".debugger-command-output")?.textContent.includes(\'"action": "shoot"\')');
  await until('![...document.querySelectorAll(".debugger-palette-item")].some(button => button.getAttribute("aria-pressed") === "true")');
  assert.equal(await evaluate('document.querySelectorAll(".debugger-powerup-target").length'), 2);
  await labelClick('Heart, x 3, y 2');
  await until('document.querySelector(".debugger-inspector-code")?.textContent.includes("x: 3")');
  assert.match(await evaluate('document.querySelector(".debugger-inspector-code").textContent'), /x: 3/);
  for (const width of [1280, 390]) await screenshot('debugger', '.debugger-arena', width);
  for (const name of ['Heart', 'Lightning']) { await click(name); await labelClick(`${name}, x ${name === 'Heart' ? 3 : 4}, y 2`); }
  assert.equal(await evaluate('document.querySelectorAll(".debugger-powerup-target").length'), 0);
  check('Static Debugger uses shared pickup visuals, inspects/removes both types and generates commands without collection');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = error.stack; console.error(error); process.exitCode = 1;
} finally {
  if (chrome) { report.browserErrors = chrome.errors; await chrome.close(); }
  await server?.close(); await fixture?.close();
  await mkdir(output, { recursive: true });
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
}
