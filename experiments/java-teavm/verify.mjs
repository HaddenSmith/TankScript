import assert from 'node:assert/strict';
import os from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { startExperiment } from './server.mjs';
import { launchChrome } from '../java-cheerpj/chrome.mjs';

const report = { measuredAt: new Date().toISOString(),
  hardware: { cpu: os.cpus()[0].model, logicalProcessors: os.cpus().length, ramGiB: os.totalmem() / 2 ** 30, os: os.version() },
  method: 'Unthrottled headless Chrome/CDP; fresh disposable profile; browser javac + TeaVM; opaque frames; local static assets; 50 steady tick rounds per group. No production app loaded.',
  checks: [], benchmarks: [], security: {} };
const output = new URL('./results/', import.meta.url);
const server = await startExperiment();
const chrome = await launchChrome();
let page;
const evaluate = expression => page.evaluate(expression, 300_000);
function check(name, detail) { report.checks.push({ name, passed: true, detail }); console.log('PASS:', name); }
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: values.length, minimumMs: sorted[0], medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)], maximumMs: sorted.at(-1) };
}
async function benchmark(count, reuse) {
  const result = await evaluate(`(async () => {
    window.actors = []; window.compilers = [];
    const startedAt = performance.now();
    let ready = [], compiled = [];
    if (!${reuse}) {
      compilers = await Promise.all(Array.from({length:${count}}, () => teavmExperiment.createSession()));
      ready = await Promise.all(compilers.map(compiler => compiler.ready));
    }
    const readyWallMs = performance.now() - startedAt;
    const compilationAt = performance.now();
    if (!${reuse}) compiled = await Promise.all(compilers.map(compiler => compiler.compile(teavmExperiment.tanks.starter)));
    if (compiled.some(reply => !reply.ok || !reply.result.successful)) throw new Error(JSON.stringify(compiled.map(reply=>({...reply,result:{...reply.result,wasm:undefined}}))));
    const compilationWallMs = performance.now() - compilationAt;
    const bytecodes = ${reuse} ? Array(${count}).fill(cachedWasm) : compiled.map(reply => reply.result.wasm);
    if (!${reuse}) window.cachedWasm = bytecodes[0];
    const actorsAt = performance.now();
    actors = await Promise.all(Array.from({length:${count}}, () => teavmExperiment.createSession({role:'runtime'})));
    const actorReady = await Promise.all(actors.map(actor => actor.ready));
    const loaded = await Promise.all(actors.map((actor,index) => actor.load(bytecodes[index])));
    if (loaded.some(reply => !reply.ok)) throw new Error(JSON.stringify(loaded));
    const constructed = await Promise.all(actors.map(actor => actor.construct(2000)));
    const first = await Promise.all(actors.map(actor => actor.runTick(teavmExperiment.snapshot,2000)));
    const timeToFirstTickMs = performance.now() - startedAt;
    const actorStartupWallMs = performance.now() - actorsAt;
    const samples = [], batchSamples = [];
    for (let round = 0; round < 50; round++) {
      const batchAt = performance.now();
      const replies = await Promise.all(actors.map(actor => actor.runTick(teavmExperiment.snapshot,2000)));
      const expected = round % 2 === 0 ? 'moveRight' : 'shoot';
      if (replies.some(reply => !reply.ok || reply.result !== expected)) throw new Error('Stateful tick regression');
      samples.push(...replies.map(reply => reply.elapsedMs)); batchSamples.push(performance.now() - batchAt);
    }
    return {ready,readyWallMs,compiled:compiled.map(reply=>({...reply,result:{...reply.result,wasm:undefined}})),
      compilationWallMs,actorReady,loaded,constructed,first,timeToFirstTickMs,actorStartupWallMs,samples,batchSamples};
  })()`);
  assert.ok(result.constructed.every(reply => reply.ok));
  assert.ok(result.first.every(reply => reply.ok && reply.result === 'shoot'));
  const workers = await chrome.memory();
  const row = { tanks: count, mode: reuse ? 'cached artifact, runtime workers only' : 'independent compilation and runtime per tank',
    readyWallMs: result.readyWallMs, compilationWallMs: result.compilationWallMs,
    compile: result.compiled.map(reply => ({ elapsedMs: reply.elapsedMs, javacMs: reply.result.javacMs, teavmMs: reply.result.teavmMs })),
    actorStartupWallMs: result.actorStartupWallMs, timeToFirstTickMs: result.timeToFirstTickMs,
    firstTickMs: result.first.map(reply => reply.elapsedMs), steadyTick: summarize(result.samples), batchRoundTrip: summarize(result.batchSamples),
    workerHeap: { workers, usedBytes: workers.reduce((total,item)=>total+item.usedSize,0),
      note: 'CDP Runtime.getHeapUsage.usedSize; no forced GC, excludes browser/process overhead and is not a memory cap' } };
  report.benchmarks.push(row);
  report.baselineImports ??= result.loaded[0].result.imports;
  report.frameIsolation ??= result.actorReady[0].isolation;
  console.log('MEASURED:', JSON.stringify({...row,workerHeap:{workers:workers.length,usedBytes:row.workerHeap.usedBytes}}));
  check(count + ' tanks / ' + row.mode, { steadySamples: row.steadyTick.samples, noTickCompilation: true });
  await evaluate('Promise.all([...actors,...compilers].map(session=>session.dispose()))');
  return row;
}

try {
  await mkdir(output, { recursive: true });
  report.browser = chrome.version.Browser;
  report.toolchain = JSON.parse(await readFile(new URL('./generated/asset-manifest.json', import.meta.url), 'utf8'));
  page = await chrome.newPage(server.appOrigin);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('!!window.teavmExperiment')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await evaluate('teavmExperiment.seeded');
  const control = await evaluate('fetch("/private/account").then(response=>response.json())');
  assert.equal(control.canary, 'dummy-authenticated-account');
  check('Dummy app private endpoint and storage positive control', control);
  const controlHits = server.hits.length;
  const netAt = chrome.network.length;
  report.coldAssets = await evaluate('teavmExperiment.loadAssets().then(({assets,elapsedMs})=>({elapsedMs,bytes:Object.values(assets).reduce((sum,bytes)=>sum+bytes.byteLength,0)}))');
  report.coldAssets.network = chrome.network.slice(netAt).filter(item=>item.url.includes('/generated/assets/'));
  const baseline = await benchmark(1, false);
  report.cache = { baseline: '1 tank: fresh Chrome profile, HTTP cache cold; local loopback, uncompressed assets. Later groups reuse that profile.' };
  await benchmark(4, false);
  if (report.benchmarks.at(-1).workerHeap.usedBytes < 800 * 2 ** 20 && report.benchmarks.at(-1).timeToFirstTickMs < 60_000) await benchmark(12, false);
  else report.skippedIndependent12 = 'Four independent compiler/runtime pairs exceeded 800 MiB JS heap or 60 s startup; prefer a shared compiler.';

  // HTTP-cache warm, but no retained compiler instance or generated tank module.
  const warmPage = await chrome.newPage(server.appOrigin);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await warmPage.evaluate('!!window.teavmExperiment')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const warmNetAt = chrome.network.length;
  report.warmAssets = await warmPage.evaluate('teavmExperiment.loadAssets().then(({elapsedMs})=>({elapsedMs}))');
  report.warmAssets.network = chrome.network.slice(warmNetAt).filter(item=>item.url.includes('/generated/assets/'));
  await warmPage.close();

  for (const count of [1,4,12]) await benchmark(count, true);
  await evaluate('(async()=>{window.compiler = await teavmExperiment.createSession(); await compiler.ready;})()');
  const warmCompile = await evaluate(`(async()=>{
    const first=await compiler.compile(teavmExperiment.tanks.starter);
    const second=await compiler.compile(teavmExperiment.tanks.starter);
    return [first,second].map(reply=>({...reply,result:{...reply.result,wasm:undefined}}));
  })()`);
  assert.ok(warmCompile.every(reply=>reply.ok&&reply.result.successful));
  report.warmCompiler = warmCompile;
  check('Reused compiler compiles twice without stale output', warmCompile.map(reply=>reply.elapsedMs));
  const broken = await evaluate('compiler.compile(teavmExperiment.tanks.broken)');
  assert.equal(broken.result.successful, false);
  assert.ok(broken.result.diagnostics.some(item=>item.severity==='error'&&item.fileName.endsWith('MyTank.java')&&item.lineNumber>0&&item.columnNumber>0));
  check('Invalid source has file, line and column diagnostics', broken);

  // Keep one healthy actor ticking while each separate failing actor is supervised.
  await evaluate('(async()=>{window.healthy = await teavmExperiment.createSession({role:"runtime"}); await healthy.load(cachedWasm); await healthy.construct(2000);})()');
  for (const fixture of ['collections','runtimeFailure','loopingTick','hangingConstructor','hangingInitializer']) {
    const result = await evaluate(`(async()=>{
      const compilation=await compiler.compile(teavmExperiment.tanks.${fixture});
      if(!compilation.ok||!compilation.result.successful) return {compilation};
      const failing=await teavmExperiment.createSession({role:'runtime'});
      const loaded=await failing.load(compilation.result.wasm);
      const before={...teavmExperiment.heartbeat};
      const start=performance.now(); let constructed, tick, error;
      const healthyPromise=healthy.runTick(teavmExperiment.snapshot,2000);
      try {
        constructed=await failing.construct(500);
        if(constructed.ok) tick=await failing.runTick(teavmExperiment.snapshot,500);
      } catch(failure) {error=failure.message;}
      const healthyTick=await healthyPromise;
      const elapsedMs=performance.now()-start;
      const after={...teavmExperiment.heartbeat};
      await failing.dispose();
      return {compilation:{...compilation,result:{...compilation.result,wasm:undefined}},loaded,constructed,tick,error,elapsedMs,before,after,healthyTick};
    })()`);
    if (!result.compilation.ok || !result.compilation.result.successful) throw new Error(fixture+': '+JSON.stringify(result));
    assert.equal(result.healthyTick.ok,true);
    if (fixture === 'collections') assert.equal(result.tick.result,'shoot');
    else if (fixture === 'runtimeFailure') assert.equal(result.tick.ok,false);
    else { assert.match(result.error,/timed out/); assert.ok(result.after.ticks-result.before.ticks>=5); }
    report.security[fixture]=result;
    check(fixture+' remains confined to its worker', { elapsedMs:result.elapsedMs, error:result.error, tick:result.tick });
  }
  report.security.native = await evaluate(`healthy.request('probe',{appOrigin:${JSON.stringify(server.appOrigin)}})`);
  assert.equal(report.security.native.result.origin,'null');
  assert.equal(report.security.native.result.indexedDBError,'SecurityError');
  assert.ok(report.security.native.result.privateFetch.error);
  assert.ok(report.security.native.result.blindPost.error);
  assert.equal(report.security.native.result.websocket,'error');
  assert.notEqual(report.security.native.result.opfs,'opened');
  assert.equal(report.security.native.result.document,'undefined');
  assert.equal(report.frameIsolation.parentDocument.error,'SecurityError');
  assert.equal(report.frameIsolation.ownCookie.error,'SecurityError');
  check('Opaque origin denies app/frame storage and credentialed or blind networking', report.security.native.result);
  const interop = await evaluate(`(async()=>{
    const compiled=await compiler.compile(teavmExperiment.tanks.interopProbe(${JSON.stringify(server.appOrigin)}));
    if(!compiled.ok||!compiled.result.successful) return {compiled};
    const actor=await teavmExperiment.createSession({role:'runtime'});
    const loaded=await actor.load(compiled.result.wasm); await actor.dispose();
    return {compiled:{...compiled,result:{...compiled.result,wasm:undefined}},loaded};
  })()`);
  report.security.interop=interop;
  assert.ok(interop.loaded && !interop.loaded.ok && /import|capabilit/i.test(interop.loaded.message));
  check('Guest JSBody is rejected by output capability validation', interop.loaded);

  for(const fixture of ['networkProbe','storageProbe']) {
    const result=await evaluate(`(async()=>{
      const source=${fixture==='networkProbe'?`teavmExperiment.tanks.networkProbe(${JSON.stringify(server.appOrigin)})`:'teavmExperiment.tanks.storageProbe'};
      const compiled=await compiler.compile(source);
      if(!compiled.ok||!compiled.result.successful) return {compiled};
      const actor=await teavmExperiment.createSession({role:'runtime'});
      const loaded=await actor.load(compiled.result.wasm); let constructed,tick;
      if(loaded.ok){constructed=await actor.construct(2000); if(constructed.ok) tick=await actor.request('tick',{snapshot:teavmExperiment.snapshot},2000);}
      await actor.dispose();return {compiled:{...compiled,result:{...compiled.result,wasm:undefined}},loaded,constructed,tick};
    })()`);
    report.security[fixture]=result;
    assert.ok(!result.compiled.ok || !result.compiled.result.successful || !result.loaded.ok || !result.tick?.ok || !String(result.tick.result).includes('dummy-authenticated-account'));
    check(fixture+' cannot obtain dummy app data', {compileSuccess:result.compiled.result?.successful,loaded:result.loaded,tick:result.tick});
  }
  report.security.guestRequests=server.hits.slice(controlHits);
  assert.equal(report.security.guestRequests.length,0);
  check('Local canary server received no guest network requests', []);
  report.security.strictCsp = await evaluate(`(async()=>{const session=await teavmExperiment.createSession({loader:'stock'});try{await session.ready;return 'unexpected success';}catch(error){return error.message;}finally{await session.dispose();}})()`);
  assert.match(report.security.strictCsp,/unsafe-eval|EvalError|code generation/i);
  check('Unmodified stock loader fails under the same restrictive CSP', report.security.strictCsp);
  const cancellation=await evaluate(`(async()=>{const session=await teavmExperiment.createSession();const start=performance.now();await session.dispose();let error;try{await session.ready;}catch(failure){error=failure.message;}return {elapsedMs:performance.now()-start,error};})()`);
  assert.ok(cancellation.error); check('Startup cancellation terminates the worker', cancellation);
  await evaluate('Promise.all([healthy,compiler].map(session=>session.dispose()))');
  assert.equal((await chrome.memory()).length,0);
  check('All experiment workers are removed after disposal', {workers:0});
  report.heartbeat=await evaluate('teavmExperiment.heartbeat');
  report.status='PASS';
} catch(error) { report.status='FAIL'; report.failure=error.stack; console.error(error); process.exitCode=1; }
finally {
  report.errors=chrome.errors;
  await mkdir(output,{recursive:true});
  await writeFile(new URL('csp-verification.json',output),JSON.stringify(report,null,2));
  await chrome.close(); await server.close();
}
