import assert from 'node:assert/strict';
import os from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { startExperiment } from './server.mjs';
import { launchChrome } from './chrome.mjs';

const report = {
  measuredAt: new Date().toISOString(),
  hardware: { cpu: os.cpus()[0].model, logicalProcessors: os.cpus().length, ramGiB: os.totalmem() / 2 ** 30, os: os.version() },
  method: 'Unthrottled headless Chrome; separate 127.0.0.1/127.0.0.2 hosts; fresh disposable profile; one JVM/worker per tank; each worker compiles once; instrumented with CDP. No production app or backend loaded.',
  checks: [], benchmarks: [],
};
const snapshot = { tankId: 1, x: 2, y: 3, health: 3 };
let server;
let chrome;
let page;
let progress;
const output = new URL('./results/', import.meta.url);
const evaluate = expression => page.evaluate(expression);
function check(name, detail) { report.checks.push({ name, passed: true, detail }); console.log('PASS:', name); }
function networkSummary(start) {
  const resources = chrome.network.slice(start).filter(item => item.url.startsWith('https://cjrtnc.leaningtech.com/5.0/'));
  return { completedResponses: resources.length, encodedBytes: resources.reduce((total, item) => total + Math.max(0, item.encodedBytes), 0), cachedResponses: resources.filter(item => item.fromDiskCache).length };
}
function summarize(values) {
  const sorted = [...values].sort((a,b) => a-b);
  return { samples: values.length, minimumMs: sorted[0], medianMs: sorted[Math.floor(sorted.length/2)], p95Ms: sorted[Math.min(sorted.length-1, Math.ceil(sorted.length*.95)-1)], maximumMs: sorted.at(-1) };
}

try {
  await mkdir(output, { recursive: true });
  server = await startExperiment();
  chrome = await launchChrome();
  report.browser = chrome.version.Browser;
  page = await chrome.newPage(server.appOrigin);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('!!window.javaExperiment')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await evaluate('javaExperiment.seeded');
  const control = await evaluate('fetch("/private/account").then(response => response.json())');
  assert.equal(control.canary, 'dummy-authenticated-account');
  check('Dummy authenticated endpoint is reachable from its own app', control);
  const controlHits = server.hits.length;
  progress = setInterval(async () => {
    console.log('Progress:', await evaluate('window.__lastStatus ?? javaExperiment.heartbeat').catch(() => null));
  }, 15_000);

  // Measure the straightforward architecture first, including one genuinely cold profile.
  for (const count of [1, 4, 12]) {
    console.log('Measuring', count, 'independent Java tanks');
    const networkStart = chrome.network.length;
    const result = await evaluate(`(async () => {
      window.__sessions = [];
      const startupAt = performance.now();
      const startup = await Promise.all(Array.from({length:${count}}, async (_,index) => {
        const actor = await javaExperiment.createJavaSession({mode:'isolated',allowEval:true,onStatus: status => { window.__lastStatus = {tank:index+1,...status}; }});
        __sessions[index] = actor;
        return actor.ready;
      }));
      const readyWallMs = performance.now()-startupAt;
      const compilationAt = performance.now();
      const compiled = await Promise.all(__sessions.map(actor => actor.compile(javaExperiment.tanks.starter,120000)));
      const compilationWallMs = performance.now()-compilationAt;
      const constructed = await Promise.all(__sessions.map(actor => actor.construct(10000)));
      const first = await Promise.all(__sessions.map(actor => actor.runTick(${JSON.stringify(snapshot)},10000)));
      const samples = [];
      const batchSamples = [];
      for(let round=0;round<50;round++) {
        const startedAt = performance.now();
        const replies = await Promise.all(__sessions.map(actor => actor.runTick(${JSON.stringify(snapshot)},2000)));
        if(replies.some(reply=>!reply.ok || !['shoot','moveRight'].includes(reply.result))) throw new Error('Unexpected tick result');
        batchSamples.push(performance.now()-startedAt);
        samples.push(...replies.map(reply=>reply.elapsedMs));
      }
      return {startup,readyWallMs,compiled,compilationWallMs,constructed,first,samples,batchSamples,heartbeat:javaExperiment.heartbeat};
    })()`);
    assert.ok(result.startup.every(item => item.javaVersion.startsWith('21.')));
    assert.ok(result.compiled.every(item => item.ok && item.result.successful && item.result.compilations === 1));
    assert.ok(result.constructed.every(item => item.ok));
    assert.ok(result.first.every(item => item.ok && item.result === 'shoot'));
    const memory = await chrome.memory();
    assert.equal(memory.length, count);
    const benchmark = {
      tanks: count, cache: count === 1 ? 'fresh Chrome profile' : 'same profile after prior measurements; HTTP cache reuse subject to range/partition behavior',
      readyWallMs: result.readyWallMs, startupMs: result.startup.map(item=>item.wallMs),
      compilationWallMs: result.compilationWallMs, compilationMs: result.compiled.map(item=>item.elapsedMs),
      firstTickMs: result.first.map(item=>item.elapsedMs), steadyTick: summarize(result.samples),
      batchRoundTrip: summarize(result.batchSamples), network: networkSummary(networkStart),
      workerHeap: { note: 'CDP Runtime.getHeapUsage, measured without forcing GC; not total process RAM or a heap limit', workers: memory,
        usedBytes: memory.reduce((total,item)=>total+item.usedSize,0), totalBytes: memory.reduce((total,item)=>total+item.totalSize,0) },
      heartbeat: result.heartbeat,
    };
    report.benchmarks.push(benchmark);
    console.log('MEASURED:', JSON.stringify({...benchmark,workerHeap:{usedBytes:benchmark.workerHeap.usedBytes,totalBytes:benchmark.workerHeap.totalBytes}}));
    check(count + ' independent Java tank(s): compiled once, 51 ticks each', {firstAction:'shoot', retainedFields:true, javaVersion:result.startup[0].javaVersion});
    report.frameIsolation = result.startup[0].frameIsolation;
    if (count !== 1) await evaluate('Promise.all(__sessions.map(actor=>actor.dispose()))');
    else {
      // Keep the first actor warm for correctness and security checks below, then release it before scaling.
      const correctness = await evaluate(`(async () => {
        const actor=__sessions[0];
        const second=await actor.runTick(${JSON.stringify(snapshot)},2000);
        const bad=await actor.compile(javaExperiment.tanks.broken);
        const source=javaExperiment.tanks.starter;
        await actor.compile(source); await actor.construct(2000);
        const native=await actor.request('probe',{},5000);
        return {second,bad,native};
      })()`);
      assert.equal(correctness.second.result, 'moveRight');
      assert.equal(correctness.bad.result.successful, false);
      assert.ok(correctness.bad.result.diagnostics.some(item=>item.kind==='ERROR' && item.line>0 && item.column>0));
      check('Fields persist; variables, loops, conditions, helper methods and classes execute', correctness.second);
      check('javac returns compilation errors with source line and column', correctness.bad);
      report.workerCapabilityProbe = correctness.native;
      await evaluate('Promise.all(__sessions.map(actor=>actor.dispose()))');
    }
    await writeFile(new URL('measurements.json', output), JSON.stringify(report,null,2));
  }

  // One warm actor is reused for guest-written probes, not just host-side checks.
  await evaluate(`(async()=>{ window.__security = await javaExperiment.createJavaSession({mode:'isolated',allowEval:true,onStatus:value=>{window.__lastStatus=value;}}); await __security.ready; })()`);
  const guestNative = await evaluate(`(async()=>{
    const compiled=await __security.compile(javaExperiment.tanks.capabilities); if(!compiled.ok || !compiled.result.successful) return compiled;
    await __security.construct(2000); return __security.request('tick',{snapshot:${JSON.stringify(snapshot)}},5000);
  })()`);
  assert.equal(guestNative.ok,true);
  const capabilities=JSON.parse(guestNative.result);
  assert.equal(capabilities.documentAvailable,false);
  assert.equal(capabilities.origin,server.executionOrigin);
  assert.equal(capabilities.localStorageAvailable,false);
  assert.equal(capabilities.indexedDB,null);
  assert.equal(capabilities.authenticatedFetchError,'TypeError');
  assert.equal(capabilities.noCorsFetchError,'TypeError');
  check('Guest Java native bridge cannot access app storage or authenticated endpoint',capabilities);
  report.guestNativeProbe=capabilities;
  const guestNetwork = await evaluate(`(async()=>{
    const config=await fetch('/config').then(response=>response.json());
    const compiled=await __security.compile(javaExperiment.tanks.networkProbe(config.appOrigin)); if(!compiled.ok || !compiled.result.successful) return compiled;
    await __security.construct(2000); return __security.request('tick',{snapshot:${JSON.stringify(snapshot)}},5000);
  })()`);
  assert.equal(guestNetwork.ok,true);
  assert.ok(!guestNetwork.result.includes('dummy-authenticated-account'));
  check('Guest java.net request to local dummy app is blocked',guestNetwork);
  const guestStorage = await evaluate(`(async()=>{
    const compiled=await __security.compile(javaExperiment.tanks.storageProbe); if(!compiled.ok || !compiled.result.successful) return compiled;
    await __security.construct(2000); return __security.request('tick',{snapshot:${JSON.stringify(snapshot)}},5000);
  })()`);
  report.guestStorageProbe=guestStorage;
  assert.equal(guestStorage.ok,true);
  assert.equal(guestStorage.result,'dummy-worker-local-data');
  check('Guest Java browser-backed storage access is measured',guestStorage);
  assert.equal(server.hits.length,controlHits);
  check('Guest probes produced zero requests at dummy private/probe endpoints',{controlRequests:controlHits,guestRequests:0});
  assert.equal(await evaluate('localStorage.getItem("poc_account")'),'dummy-local-storage-secret');
  assert.equal(report.frameIsolation.parentDocument.error,'SecurityError');
  assert.equal(report.frameIsolation.parentLocalStorage.error,'SecurityError');
  assert.equal(report.frameIsolation.ownCookie.value,'');
  assert.equal(report.frameIsolation.ownLocalStorage.value,null);
  check('Cross-origin frame cannot read parent document, cookies or local storage',report.frameIsolation);
  await evaluate('__security.dispose()');

  for(const [name,sourceName,phase] of [
    ['Infinite tick','loopingTick','tick'],['Hanging constructor','hangingConstructor','construct'],['Hanging static initializer','hangingInitializer','construct'],
  ]) {
    console.log('Testing:',name);
    const result=await evaluate(`(async()=>{
      const actor=await javaExperiment.createJavaSession({mode:'isolated',allowEval:true,onStatus:value=>{window.__lastStatus=value;}});
      await actor.ready;
      const compiled=await actor.compile(javaExperiment.tanks.${sourceName});
      if(!compiled.ok || !compiled.result.successful) throw new Error('Could not compile timeout fixture');
      if(${JSON.stringify(phase)}==='tick') await actor.construct(2000);
      const before=javaExperiment.heartbeat.beats;
      const startedAt=performance.now();
      let failure;
      try {
        if(${JSON.stringify(phase)}==='tick') await actor.runTick(${JSON.stringify(snapshot)},500);
        else await actor.construct(500);
      } catch(error) { failure=error.message; }
      await actor.dispose();
      return {failure,elapsedMs:performance.now()-startedAt,heartbeatTicks:javaExperiment.heartbeat.beats-before,frames:document.querySelectorAll('iframe').length};
    })()`);
    assert.match(result.failure,/deadline exceeded/);
    assert.ok(result.elapsedMs<2000);
    assert.ok(result.heartbeatTicks>0);
    assert.equal(result.frames,0);
    check(name+': external watchdog terminates worker without freezing page',result);
  }
  const cancelled=await evaluate(`(async()=>{
    const actor=await javaExperiment.createJavaSession({mode:'isolated',allowEval:true});
    const readiness=actor.ready.then(()=> 'unexpected-ready',error=>error.message);
    await actor.dispose('Explicit startup cancellation');
    return {message:await readiness,frames:document.querySelectorAll('iframe').length};
  })()`);
  assert.equal(cancelled.message,'Explicit startup cancellation');
  assert.equal(cancelled.frames,0);
  check('Startup cancellation settles readiness and removes its frame',cancelled);
  report.finalHeartbeat=await evaluate('javaExperiment.heartbeat');
  report.status='PASS';
} catch(error) {
  report.status='FAIL'; report.error=error.stack ?? error.message;
  console.error(report.error);
  process.exitCode=1;
} finally {
  clearInterval(progress);
  report.network=chrome?.network;
  report.runtimeErrors=chrome?.errors;
  report.dummyEndpointHits=server?.hits;
  await mkdir(output,{recursive:true});
  await writeFile(new URL('measurements.json',output),JSON.stringify(report,null,2));
  if(page) {
    await page.evaluate('document.querySelector("#output").textContent='+JSON.stringify(JSON.stringify({status:report.status,checks:report.checks,benchmarks:report.benchmarks.map(({tanks,readyWallMs,compilationWallMs,steadyTick})=>({tanks,readyWallMs,compilationWallMs,steadyTick}))},null,2))).catch(()=>{});
    const screenshot=await page.screenshot().catch(()=>null);
    if(screenshot) await writeFile(new URL('experiment.png',output),Buffer.from(screenshot.data,'base64'));
  }
  await chrome?.close();
  await server?.close();
  console.log('Report:',new URL('measurements.json',output).pathname,report.status);
}
