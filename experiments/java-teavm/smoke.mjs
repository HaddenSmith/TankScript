import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startExperiment } from './server.mjs';
import { launchChrome } from '../java-cheerpj/chrome.mjs';

const server = await startExperiment();
const chrome = await launchChrome();
try {
  const page = await chrome.newPage(server.appOrigin);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await page.evaluate('!!window.teavmExperiment')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const result = await page.evaluate(`(async () => {
    const assets = await teavmExperiment.loadAssets();
    const compiler = await teavmExperiment.createSession();
    window.smokeCompiler = compiler;
    const ready = await compiler.ready;
    const compiled = await compiler.compile(teavmExperiment.tanks.starter);
    if (!compiled.ok || !compiled.result.successful) return {ready,compiled};
    const wasm = compiled.result.wasm;
    delete compiled.result.wasm;
    const actor = await teavmExperiment.createSession({role:'runtime'});
    window.smokeActor = actor;
    const actorReady = await actor.ready;
    const loaded = await actor.load(wasm);
    const constructed = loaded.ok ? await actor.construct(2000) : null;
    const first = constructed?.ok ? await actor.runTick(teavmExperiment.snapshot,2000) : null;
    const second = first?.ok ? await actor.runTick(teavmExperiment.snapshot,2000) : null;
    return {assetsMs:assets.elapsedMs,ready,compiled,actorReady,loaded,constructed,first,second};
  })()`, 240_000);
  await mkdir(new URL('./results/', import.meta.url), { recursive: true });
  await writeFile(new URL('./results/csp-smoke.json', import.meta.url), JSON.stringify({ browser: chrome.version.Browser, result, errors: chrome.errors }, null, 2));
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.compiled.ok, true);
  assert.equal(result.compiled.result.successful, true);
  assert.equal(result.first.result, 'shoot');
  assert.equal(result.second.result, 'moveRight');
} finally { await chrome.close(); await server.close(); }
