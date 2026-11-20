import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { startExperiment } from './server.mjs';
import { launchChrome } from '../java-cheerpj/chrome.mjs';

const server = await startExperiment();
const chrome = await launchChrome();
const report = { measuredAt:new Date().toISOString(),browser:chrome.version.Browser,checks:[],processMemory:[] };
report.toolchain = JSON.parse(await readFile(new URL('./generated/asset-manifest.json',import.meta.url),'utf8'));
const check = (name,detail) => { report.checks.push({name,passed:true,detail}); console.log('PASS:',name); };
try {
  const page = await chrome.newPage(server.appOrigin);
  await chrome.send('Emulation.setDeviceMetricsOverride', { width:1100,height:1050,deviceScaleFactor:1,mobile:false },page.target.sessionId);
  const evaluate = expression => page.evaluate(expression,180_000);
  async function until(expression) {
    for(let attempt=0;attempt<1200;attempt++) {
      if(await evaluate(expression)) return;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error('Timed out waiting for '+expression);
  }
  await until('!!window.teavmExperiment');
  await evaluate('teavmExperiment.seeded');
  await evaluate('document.querySelector("#compile").click()');
  await until('!document.querySelector("#tick").disabled');
  await evaluate('document.querySelector("#tick").click()');
  await until('document.querySelector("#output").textContent.includes("shoot")');
  await evaluate('document.querySelector("#tick").click()');
  await until('document.querySelector("#output").textContent.includes("moveRight")');
  check('Actual Compile and Tick controls retain Java fields',await evaluate('document.querySelector("#output").textContent'));
  const screenshot=await page.screenshot();
  await mkdir(new URL('./results/',import.meta.url),{recursive:true});
  await writeFile(new URL('./results/csp-experiment.png',import.meta.url),Buffer.from(screenshot.data,'base64'));
  await evaluate('document.querySelector("#stop").click()');
  await until('document.querySelector("#output").textContent.includes("Workers stopped")');
  assert.equal((await chrome.memory()).length,0);
  check('UI Stop removes compiler and runtime workers',{});

  await evaluate('(async()=>{window.compiler=await teavmExperiment.createSession();window.compilerReady=await compiler.ready;})()');
  const interop=await evaluate(`(async()=>{
    const compiled=await compiler.compile(teavmExperiment.tanks.oneArgumentInteropProbe(${JSON.stringify(server.appOrigin)}));
    if(!compiled.ok||!compiled.result.successful)return {compiled};
    const actor=await teavmExperiment.createSession({role:'runtime'});
    const loaded=await actor.load(compiled.result.wasm); let constructed,tick;
    if(loaded.ok){constructed=await actor.construct(2000); if(constructed.ok)tick=await actor.request('tick',{snapshot:teavmExperiment.snapshot},2000);}
    const probe=await actor.request('probe',{appOrigin:${JSON.stringify(server.appOrigin)}},5000);
    await actor.dispose();
    return {compiled:{...compiled,result:{...compiled.result,wasm:undefined}},loaded,constructed,tick,probe};
  })()`);
  assert.equal(interop.compiled.result.successful,true);
  assert.ok([interop.loaded,interop.constructed,interop.tick].some(reply=>reply&&!reply.ok&&/Disallowed JavaScript helper capability/.test(reply.message)));
  check('An allowed import name cannot smuggle an arbitrary JSBody',interop);
  assert.equal(interop.probe.result.websocket,'error');
  assert.notEqual(interop.probe.result.opfs,'opened');
  assert.equal(server.hits.length,0);
  check('WebSocket and OPFS blocked; local endpoint saw zero requests',interop.probe);
  report.compilerReady=await evaluate('compilerReady');

  await evaluate('(async()=>{const result=await compiler.compile(teavmExperiment.tanks.starter);if(!result.ok||!result.result.successful)throw new Error(JSON.stringify(result));window.wasm=result.result.wasm;window.healthy=await teavmExperiment.createSession({role:"runtime"});await healthy.load(wasm);await healthy.construct(2000);})()');
  for(const fixture of ['loopingTick','hangingConstructor','hangingInitializer']) {
    const result=await evaluate(`(async()=>{
      const compiled=await compiler.compile(teavmExperiment.tanks.${fixture});
      if(!compiled.ok||!compiled.result.successful)throw new Error(JSON.stringify(compiled));
      const failing=await teavmExperiment.createSession({role:'runtime'});
      const loaded=await failing.load(compiled.result.wasm);if(!loaded.ok)throw new Error(loaded.message);
      const before={...teavmExperiment.heartbeat},start=performance.now();let healthyReplyMs,failedMs,error;
      // Deliberately request this tick after the other worker has entered its loop.
      const healthyPromise=new Promise(resolve=>setTimeout(resolve,100)).then(async()=>{
        const reply=await healthy.runTick(teavmExperiment.snapshot,2000);healthyReplyMs=performance.now()-start;return reply;
      });
      try{const constructed=await failing.construct(500);if(!constructed.ok)throw new Error(constructed.message);await failing.runTick(teavmExperiment.snapshot,500);}
      catch(failure){error=failure.message;failedMs=performance.now()-start;}
      const healthyTick=await healthyPromise,after={...teavmExperiment.heartbeat};await failing.dispose();
      return {healthyTick,healthyReplyMs,failedMs,error,before,after};
    })()`);
    assert.match(result.error,/timed out/);assert.equal(result.healthyTick.ok,true);
    assert.ok(result.healthyReplyMs>=80&&result.healthyReplyMs<result.failedMs);
    assert.ok(result.after.ticks-result.before.ticks>=5);
    check('Healthy tank responds during '+fixture+' before termination',result);
  }
  await evaluate('Promise.all([healthy,compiler].map(session=>session.dispose()))');
  for(const count of [1,4,12]) {
    const state=await evaluate(`(async()=>{
      window.actors=await Promise.all(Array.from({length:${count}},()=>teavmExperiment.createSession({role:'runtime'})));
      await Promise.all(actors.map(actor=>actor.load(wasm))); await Promise.all(actors.map(actor=>actor.construct(2000)));
      const first=await Promise.all(actors.map(actor=>actor.runTick(teavmExperiment.snapshot,2000)));
      const second=await actors[0].runTick(teavmExperiment.snapshot,2000);
      return {first,second};
    })()`);
    assert.ok(state.first.every(reply=>reply.ok&&reply.result==='shoot'));
    assert.equal(state.second.result,'moveRight');
    const processInfo=await chrome.send('SystemInfo.getProcessInfo');
    const ids=processInfo.processInfo.map(item=>Number(item.id)).filter(Number.isSafeInteger);
    let processes;
    if(process.platform==='win32') {
      processes=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',
        `Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`],{windowsHide:true,encoding:'utf8'}));
      if(!Array.isArray(processes))processes=[processes];
    }
    report.processMemory.push({tanks:count,mode:'Separate follow-up trial, cached browser-compiled artifact; compiler disposed; managed Chrome extensions included',processes,
      workingSetBytes:processes?.reduce((sum,item)=>sum+item.WorkingSet64,0),privateCommittedBytes:processes?.reduce((sum,item)=>sum+item.PrivateMemorySize64,0),workers:await chrome.memory()});
    check(count+' cached instances have separate Java object state',{first:'shoot',second:'moveRight'});
    await evaluate('Promise.all(actors.map(actor=>actor.dispose()))');
  }
  report.status='PASS';
}catch(error){report.status='FAIL';report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{
  report.hits=server.hits; report.errors=chrome.errors;
  await mkdir(new URL('./results/',import.meta.url),{recursive:true});
  await writeFile(new URL('./results/csp-extra.json',import.meta.url),JSON.stringify(report,null,2));
  await chrome.close(); await server.close();
}
