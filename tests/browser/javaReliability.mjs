import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { launchChrome } from '../../experiments/java-cheerpj/chrome.mjs';

// This minimal local page isolates runtime costs from React/Monaco. No backend is used.
const phase=process.argv.find(arg=>arg.startsWith('--phase='))?.split('=')[1]??'after';
const diagnostics=process.argv.includes('--diagnostics');
const startupDelay=process.argv.includes('--startup-delay');
const behaviour=process.argv.includes('--behaviour')||startupDelay;
const detach=process.argv.includes('--detach-workers');
const domainsOff=process.argv.includes('--worker-domains-off');
const paced=process.argv.includes('--paced');
const trace=process.argv.includes('--trace');
const counts=process.argv.includes('--twelve-only')?[12]:[1,4,12];
const edge=process.argv.includes('--edge');
if(edge)process.env.TANKSCRIPT_EXPERIMENT_CHROME='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
if(!['before','after'].includes(phase))throw Error('Use --phase=before or --phase=after');
process.env.VITE_EXPERIMENTAL_JAVA='true';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error',plugins:[{
  name:'java-reliability-page',enforce:'pre',configureServer(server){server.middlewares.use('/__java-reliability__',(_req,res)=>{
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Java reliability</title><h1>Local Java reliability check</h1><script type="module">import "/@vite/client";window.testReady=true;</script>');
  });},
  transform(code,id){
    if(startupDelay && id.endsWith('/javaWorkerSession.js'))return code.replace(
      "worker.postMessage('connect-java-worker', [data.port]);",
      "setTimeout(() => worker.postMessage('connect-java-worker', [data.port]), 650);",
    ).replace('dataChannel.port1.postMessage({ id, type,',
      "(globalThis.javaProgramRequests ??= []).push({type,at:performance.now()}); dataChannel.port1.postMessage({ id, type,");
  },
}]});
await server.listen();
const origin='http://127.0.0.1:'+server.httpServer.address().port;
const report={phase,measuredAt:new Date().toISOString(),method:'Fresh profiles, minimal local page; OS/Vite caches retained',samples:[],checks:[]};
const java=(body,fields='')=>'import tankscript.TankScript;public class MyTank{'+fields+' public void tick(TankScript.Snapshot s,TankScript api){'+body+'}}';
const source=java('ticks++;if(ticks%2==1)api.rotateLeft();else api.rotateRight();api.shoot();','private int ticks;');
let chrome,page;
let stopTrace;
const evaluate=code=>page.evaluate(code,180_000);
async function open(){
  chrome=await launchChrome({pauseNewTargets:!startupDelay});report.browser=chrome.version.Browser;
  page=await chrome.newPage(origin+'/__java-reliability__');
  for(let i=0;i<100;i++){if(await evaluate('window.testReady===true'))break;await new Promise(r=>setTimeout(r,50));}
  await evaluate(`window.ready=Promise.all([import('/frontend/src/game/tank-script/java/javaTankRunner.js'),import('/frontend/src/game/tank-script/java/javaWorkerSession.js'),import('/frontend/src/game/tank-script/java/javaRuntimeAssets.js')]).then(([r,s,a])=>{
    window.createRunner=(source,options={})=>r.createJavaTankRunner(source,{...options,measureTimings:true});
    window.createSession=signal=>s.createJavaWorkerSession(signal,{measureTimings:true});window.loadAssets=a.loadJavaRuntimeAssets;
  });window.snapshot={tankId:1,tankPosition:{x:1,y:1},tankRotation:0,tankHealth:3,arenaWidth:20,arenaHeight:20,
    allTanks:Array.from({length:12},(_,i)=>({id:i+1,name:'Java',x:i+1,y:1,rotation:0,health:3})),allBullets:[]};ready;`);
}
async function memory(workerHeaps=true){
  const info=await chrome.send('SystemInfo.getProcessInfo');
  const ids=info.processInfo.map(p=>Number(p.id)).filter(Number.isSafeInteger);
  let processes=[];
  if(process.platform==='win32'){
    processes=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',
      `Get-Process | Where-Object { $_.Id -in @(${ids.join(',')}) } | Select-Object Id,PrivateMemorySize64,WorkingSet64 | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true}));
    if(!Array.isArray(processes))processes=[processes];
  }
  return {privateBytes:processes.reduce((n,p)=>n+p.PrivateMemorySize64,0),workingSetBytes:processes.reduce((n,p)=>n+p.WorkingSet64,0),
    workers:workerHeaps?await chrome.memory():[],main:(await chrome.send('Runtime.getHeapUsage',{},page.target.sessionId))};
}
async function collectGC(){
  for(const target of chrome.targets.values())if(target.alive&&['worker','page'].includes(target.type))await chrome.send('HeapProfiler.collectGarbage',{},target.sessionId);
}
async function startGCTrace(){
  const socket=new WebSocket(chrome.version.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  const pending=new Map(),events=[];let id=0,complete;
  const done=new Promise(resolve=>{complete=resolve;});
  socket.onmessage=({data})=>{
    const message=JSON.parse(data);
    if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(Error(message.error.message)):p.resolve(message.result);}
    if(message.method==='Tracing.dataCollected')events.push(...message.params.value);
    if(message.method==='Tracing.tracingComplete')complete(message.params);
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{const call=++id;pending.set(call,{resolve,reject});socket.send(JSON.stringify({id:call,method,params}));});
  await send('Tracing.start',{traceConfig:{recordMode:'recordContinuously',includedCategories:['v8','disabled-by-default-v8.gc','blink.user_timing']}});
  const epoch=await evaluate('performance.mark("java-gc-clock");performance.timeOrigin+performance.getEntriesByName("java-gc-clock").at(-1).startTime');
  return async()=>{
    await send('Tracing.end');const completion=await done;socket.close();
    const marker=events.find(event=>event.name==='java-gc-clock');const offset=marker?epoch-marker.ts/1000:undefined;
    const pauses=events.filter(event=>event.dur>0&&/GC|Scavenge|MarkCompact/.test(event.name)).sort((a,b)=>b.dur-a.dur).slice(0,30).map(event=>({
      name:event.name,pid:event.pid,tid:event.tid,wallMs:event.dur/1000,threadMs:event.tdur===undefined?undefined:event.tdur/1000,
      epochMs:offset===undefined?undefined:event.ts/1000+offset,
    }));
    return {events:events.length,dataLoss:completion.dataLossOccurred,pauses,threads:events.filter(event=>event.name==='thread_name').map(event=>({pid:event.pid,tid:event.tid,name:event.args?.name}))};
  };
}
function check(name,detail){report.checks.push({name,detail});console.log('PASS:',name);}
try{
  if(!diagnostics&&!behaviour){
  for(const count of counts){
    await open();const baseline=await memory();
    const cold=await evaluate(`(async()=>{const start=performance.now();window.actors=[];for(let i=0;i<${count};i++)actors.push(await createRunner(${JSON.stringify(source)}));
      const initialized=performance.now();const actions=await Promise.all(actors.map(a=>a.runTick(snapshot)));return {initializationMs:initialized-start,totalFirstTickMs:performance.now()-start,
        actions,timings:actors.map(a=>a.timings)};})()`);
    assert.ok(cold.actions.every(a=>a.action==='rotateLeft'));const coldMemory=await memory();
    await evaluate('Promise.all(actors.map(a=>a.dispose()))');
    const warm=await evaluate(`(async()=>{const start=performance.now();window.actors=[];for(let i=0;i<${count};i++)actors.push(await createRunner(${JSON.stringify(source)}));
      const initialized=performance.now();await Promise.all(actors.map(a=>a.runTick(snapshot)));return {initializationMs:initialized-start,totalFirstTickMs:performance.now()-start,timings:actors.map(a=>a.timings)};})()`);
    const beforeTicks=await memory();
    if(detach)for(const target of chrome.targets.values())if(target.alive&&target.type==='worker'){
      let detached=false;
      for(const parent of chrome.targets.values())if(parent.alive&&['page','iframe'].includes(parent.type)){
        try{await chrome.send('Target.detachFromTarget',{sessionId:target.sessionId},parent.sessionId);detached=true;break;}catch{}
      }
      assert.equal(detached,true,'Cannot detach worker inspector');
    }
    if(domainsOff)for(const target of chrome.targets.values())if(target.alive&&target.type==='worker'){
      await chrome.send('Network.disable',{},target.sessionId);await chrome.send('Runtime.disable',{},target.sessionId);
    }
    if(trace)stopTrace=await startGCTrace();
    await evaluate(`window.sample=async(n)=>{const durations=[],worker=[],snapshotTimes=[],guest=[],outbound=[],inbound=[],failures=[];let successful=0,worstTiming;for(let tick=0;tick<n;tick++){
      const start=performance.now();await Promise.all(actors.map(async(a,i)=>{try{const command=await a.runTick(snapshot);if(!command||!['rotateLeft','rotateRight'].includes(command.action))throw Error('bad action');successful++;
        const timing=a.getLastRequestTiming();if(timing?.worker){if(!worstTiming||timing.worker.executionMs>worstTiming.worker.executionMs)worstTiming=timing;worker.push(timing.worker.executionMs);snapshotTimes.push(timing.worker.snapshotMs);guest.push(timing.worker.tickMs);outbound.push(Math.max(0,timing.worker.receivedAt-timing.postedAt));inbound.push(Math.max(0,timing.receivedAt-timing.worker.finishedAt));}
      }catch(error){if(!failures.some(f=>f.tank===i))failures.push({tank:i,tick,code:error.code,timing:a.getLastRequestTiming()});}}));durations.push(performance.now()-start);
      if(${paced} && tick%64===63)await new Promise(resolve=>setTimeout(resolve,4));
    }const summary=values=>{values=values.filter(Number.isFinite).sort((a,b)=>a-b);return {n:values.length,median:values[Math.floor(values.length/2)],p95:values[Math.floor(values.length*.95)],max:values.at(-1)};};
    return {batches:n,successful,failures,worstTiming,roundTrip:summary(durations),worker:summary(worker),snapshot:summary(snapshotTimes),guest:summary(guest),outbound:summary(outbound),inbound:summary(inbound)};};`);
    const short=await evaluate('sample(200)');assert.equal(short.failures.length,0,JSON.stringify(short.failures));
    const blocks=[];for(let i=0;i<3;i++){
      const ticks=await evaluate('sample(2000)');
      if(ticks.failures.length)report.lastFailureProbe={count,ticks};
      if(phase==='after')assert.equal(ticks.successful,count*2000,JSON.stringify(ticks.failures));
      blocks.push({ticks,memory:await memory()});
    }
    if(stopTrace){report.trace=await stopTrace();stopTrace=undefined;}
    await collectGC();const afterGC=await memory();
    await evaluate('Promise.all(actors.map(a=>a.dispose()))');await collectGC();const afterDispose=await memory();
    assert.equal(afterDispose.workers.length,0);
    let targets;
    for(let i=0;i<40;i++){
      targets=(await chrome.send('Target.getTargets')).targetInfos.filter(t=>t.type==='worker');
      if(!targets.length)break;await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(targets.length,0,'Worker targets remain after disposal');
    const result={count,baseline,cold,coldMemory,warm,beforeTicks,short,blocks,afterGC,afterDispose};report.samples.push(result);
    if(stopTrace){report.trace=await stopTrace();stopTrace=undefined;}
    check('Measured '+count+' genuine Java tanks through 6,200 batches',{failures:blocks.flatMap(b=>b.ticks.failures)});
    await chrome.close();chrome=undefined;
  }
  await open();
  // A parent-thread stall deliberately delays relay/response tasks, not guest code.
  const delayed=await evaluate(`(async()=>{const runner=await createRunner(${JSON.stringify(source)});try{
    const pending=runner.runTick(snapshot).then(command=>({command}),error=>({code:error.code}));const start=performance.now();while(performance.now()-start<180){};
    const result=await pending;return {...result,timing:runner.getLastRequestTiming()};
  }finally{await runner.dispose();}})()`);
  report.parentStall=delayed;
  if(phase==='before')assert.equal(delayed.code,'EXECUTION_TIMEOUT');else assert.equal(delayed.command.action,'rotateLeft');
  check('Parent stall is distinguished from Java execution',delayed);
  }else if(diagnostics){
    await open();const baseline=await memory();
    await evaluate(`(async()=>{
      const [body,api,protocol,sdk,entry]=await Promise.all([
        import('/frontend/src/game/tank-script/java/javaTankWorker.js?raw'),import('/frontend/src/game/tank-script/shared/tankScriptApi.js'),
        import('/frontend/src/game/tank-script/shared/tankScriptRunnerProtocol.js'),import('/frontend/src/game/tank-script/java/TankScript.java?raw'),
        import('/frontend/src/game/tank-script/java/TankEntrypoint.java?raw')]);
      window.trustedWorker='const createTankScriptApi='+api.createTankScriptApi.toString()+';const actions='+JSON.stringify(protocol.TANK_SCRIPT_ACTIONS)+';'+body.default;
      window.sdk=sdk.default;window.entry=entry.default;window.assets=await loadAssets();window.compilerSession=createSession();
      await compilerSession.request('initializeCompiler',{workerSource:trustedWorker,assets},30000);
    })()`);
    const compilerInitialized=await memory();const peaks=[];let done=false;
    const compiling=evaluate(`compilerSession.request('compile',{source:${JSON.stringify(source)},sdk,entrypoint:entry},120000).then(result=>{if(result.error)throw Error(JSON.stringify(result.error));return {wasmBytes:result.wasm.byteLength,compilationMs:result.compilationMs};})`)
      .then(result=>{report.compiled=result;}).finally(()=>{done=true;});
    while(!done){peaks.push(await memory(false));await new Promise(resolve=>setTimeout(resolve,500));}
    await compiling;const compilerAfterCompile=await memory();await evaluate('compilerSession.dispose()');await collectGC();
    const compilerDisposed=await memory();assert.equal(compilerDisposed.workers.length,0);
    report.compiler={baseline,compilerInitialized,compilerAfterCompile,compilerDisposed,peaks,
      peakPrivateBytes:Math.max(...peaks.map(m=>m.privateBytes)),assets:await evaluate('Object.fromEntries(Object.entries(assets).map(([name,bytes])=>[name,bytes.byteLength]))')};
    check('Compiler peak and disposal measured',report.compiled);
    await chrome.close();chrome=undefined;
    // Compare equivalent message traffic without any Java/Wasm heap.
    const control=`let send;self.onmessage=e=>{if(e.ports[0]){const p=e.ports[0];send=p.postMessage.bind(p);p.onmessage=run;send({workerReady:true});}else{send=self.postMessage.bind(self);run(e);}};function run({data}){let action=null;if(data.type==='runTick'){JSON.parse(data.snapshotJSON);action='rotateLeft';}send({id:data.id,result:{action}});}`;
    report.controls=[];
    for(const count of [4,12]){
      await open();const baseline=await memory();
      await evaluate(`(async()=>{window.sessions=[];for(let i=0;i<${count};i++){const s=createSession();await s.request('initializeCompiler',{workerSource:${JSON.stringify(control)}},30000);sessions.push(s);}})()`);
      const initialized=await memory();const blocks=[];
      for(let i=0;i<3;i++){
        await evaluate(`(async()=>{for(let tick=0;tick<2000;tick++)await Promise.all(sessions.map(s=>s.request('runTick',{snapshotJSON:JSON.stringify(snapshot)},500)));})()`);
        blocks.push(await memory());
      }
      await collectGC();const afterGC=await memory();await evaluate('Promise.all(sessions.map(s=>s.dispose()))');const disposed=await memory();
      assert.equal(disposed.workers.length,0);report.controls.push({count,baseline,initialized,blocks,afterGC,disposed});
      check('No-Wasm control measured '+count+' workers');await chrome.close();chrome=undefined;
    }
  }else{
    await open();
    await evaluate(`(async()=>{window.peer=await createRunner(${JSON.stringify(source)});window.peerActions=[];window.heartbeats=0;window.beat=setInterval(()=>heartbeats++,10);})()`);
    if(startupDelay){
      const timings=await evaluate('peer.timings');
      assert.ok(timings.runtimeInitializationMs>=650);
      check('Real Java survives a deliberate 650 ms trusted worker handshake',timings);
    }
    const finite50=java('long start=System.currentTimeMillis();while(System.currentTimeMillis()-start<50){}api.shoot();');
    const accepted=await evaluate(`(async()=>{const actor=await createRunner(${JSON.stringify(finite50)});try{const command=await actor.runTick(snapshot);return {command,timing:actor.getLastRequestTiming()};}finally{await actor.dispose();}})()`);
    assert.equal(accepted.command.action,'shoot');check('Finite 50 ms Java succeeds',accepted);
    const fixtures=[
      ['finite 180 ms tick',java('api.shoot();long start=System.currentTimeMillis();while(System.currentTimeMillis()-start<180){}'),'EXECUTION_TIMEOUT',false],
      ['infinite tick',java('while(true){}'),'EXECUTION_TIMEOUT',false],
      ['hanging constructor',java('','public MyTank(){while(true){}}'),'WORKER_TIMEOUT',true],
      ['hanging static initializer',java('','static{if(hang())while(true){}}private static boolean hang(){return true;}'),'WORKER_TIMEOUT',true],
      ['finite 180 ms constructor',java('','public MyTank(){long start=System.currentTimeMillis();while(System.currentTimeMillis()-start<180){}}'),'EXECUTION_TIMEOUT',true],
    ];
    for(const [name,code,expected,initialization] of fixtures){
      const result=await evaluate(`(async()=>{
        let actor,start,healthyAt,healthyPromise;const before=heartbeats;
        const runPeer=()=>new Promise(resolve=>setTimeout(resolve,20)).then(async()=>{const command=await peer.runTick(snapshot);peerActions.push(command.action);healthyAt=performance.now()-start;return command;});
        try{
          if(${initialization}){actor=await createRunner(${JSON.stringify(code)},{onStatus:message=>{if(message==='Starting Java tank…'){start=performance.now();window.javaProgramRequests=[];healthyPromise=runPeer();}}});}
          else{actor=await createRunner(${JSON.stringify(code)});start=performance.now();window.javaProgramRequests=[];healthyPromise=runPeer();await actor.runTick(snapshot);}
          return {unexpectedSuccess:true};
        }catch(error){const elapsedMs=performance.now()-start;const posted=window.javaProgramRequests.find(request=>request.type===${JSON.stringify(initialization?'construct':'runTick')});
          const programElapsedMs=posted?performance.now()-posted.at:undefined;
          const healthy=await healthyPromise;return {code:error.code,message:error.message,elapsedMs,programElapsedMs,healthy,healthyAt,heartbeatTicks:heartbeats-before,timing:actor?.getLastRequestTiming()};}
        finally{await actor?.dispose();}
      })()`);
      assert.equal(result.code,expected,JSON.stringify(result));assert.ok(result.healthyAt<result.elapsedMs);
      // The injected handshake delay precedes any Java call; measure its watchdog separately.
      assert.ok((startupDelay && initialization ? result.programElapsedMs : result.elapsedMs)<2000,'Termination was not prompt');
      check('Healthy peer survives '+name,result);
    }
    const cancelled=await evaluate(`(async()=>{const controller=new AbortController();const actor=await createRunner(${JSON.stringify(java('while(true){}'))},{signal:controller.signal});
      const start=performance.now(),timer=setTimeout(()=>controller.abort(),80);try{await actor.runTick(snapshot);return {unexpectedSuccess:true};}
      catch(error){return {code:error.code,elapsedMs:performance.now()-start};}finally{clearTimeout(timer);await actor.dispose();}})()`);
    assert.equal(cancelled.code,'DISPOSED');assert.ok(cancelled.elapsedMs<500);check('Cancellation terminates an infinite tick',cancelled);
    const state=await evaluate('peerActions');assert.deepEqual(state,['rotateLeft','rotateRight','rotateLeft','rotateRight','rotateLeft']);
    await evaluate('clearInterval(beat);peer.dispose()');
    assert.equal(await evaluate('document.querySelectorAll(\'iframe[title="Experimental Java execution"]\').length'),0);
    check('Java peer retained state and every worker frame was removed',state);
  }
  report.status='PASS';
}catch(error){report.status='FAIL';report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{
  if(stopTrace){report.trace=await stopTrace();stopTrace=undefined;}
  if(chrome)await chrome.close();await server.close();
  await mkdir(new URL('../../experiments/java-teavm/results/',import.meta.url),{recursive:true});
  const suffix=(startupDelay?'startup-delay':diagnostics?'diagnostics':behaviour?'behaviour':phase+(detach?'-detached':'')+(domainsOff?'-domains-off':'')+(paced?'-paced':'')+(trace?'-trace':''))+(edge?'-edge':'');
  await writeFile(new URL('../../experiments/java-teavm/results/reliability-'+suffix+'.json',import.meta.url),JSON.stringify(report,null,2));
}
