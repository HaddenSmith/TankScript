import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { launchChrome } from '../java-cheerpj/chrome.mjs';

// Smaller lab than javaResources.mjs: one compiler/runtime, at most 32 MiB of
// requested Java array payload, 2.5 GiB host headroom and a 1 GiB profile cutoff.
// These are test stopping rules, not Java heap enforcement.
process.env.VITE_EXPERIMENTAL_JAVA='true';
const report={measuredAt:new Date().toISOString(),compilerLinearMaxMiB:16,runtimeLinearMaxMiB:4,checks:[],samples:[]};
const worker=await readFile(new URL('../../frontend/src/game/tank-script/java/javaTankWorker.js',import.meta.url),'utf8');
const sdk=await readFile(new URL('../../frontend/src/game/tank-script/java/TankScript.java',import.meta.url),'utf8');
const entrypoint=await readFile(new URL('../../frontend/src/game/tank-script/java/TankEntrypoint.java',import.meta.url),'utf8');
// Only trusted lab instrumentation changes. Keep the actual worker's import
// allowlist, opaque frame, CSP, 100 ms call budget and 500 ms watchdog.
let instrumented='let labMemory;\n'+worker;
assert.ok(instrumented.includes('if (!runtimeOnly) return load(wasm, { noAutoImports: true });'));
instrumented=instrumented.replace('if (!runtimeOnly) return load(wasm, { noAutoImports: true });',
  'if (!runtimeOnly) return load(wasm, { noAutoImports: true, memory: { maxSize: 16 * 1024 * 1024 }, installImports(host) { labMemory = host.env.memory; } });');
instrumented=instrumented.replace('maxSize: 64 * 1024 * 1024','maxSize: 4 * 1024 * 1024');
instrumented=instrumented.replace('installImports(host) {\n','installImports(host) {\n      labMemory = host.env.memory;\n');
instrumented=instrumented.replace("} else if (data.type === 'construct') {",`}
    else if (data.type === 'inspectLinearMemory') {
      result = { bytes: labMemory.buffer.byteLength, origin: self.origin };
      if (data.growPages) {
        try { labMemory.grow(data.growPages); result.grew = true; }
        catch (error) { result.growError = error.name; }
        result.bytesAfter = labMemory.buffer.byteLength;
      }
    } else if (data.type === 'construct') {`);
const server=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{
  name:'bounded-java-memory-lab',enforce:'pre',configureServer(server){server.middlewares.use('/__java-memory__',(_req,res)=>{
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Java memory lab</title><h1>Bounded Java memory experiment</h1><script type="module">import "/@vite/client";window.labReady=true;</script>');
  });},
}]});
let chrome,page,sampler,finishSampler;
const check=(name,detail)=>{report.checks.push({name,detail});console.log('PASS:',name);};
const java=`import tankscript.TankScript;
public class MyTank {
  private byte[] held;
  public void tick(TankScript.Snapshot state, TankScript api) {
    if (state.tankRotation() == 90) { api.rotateLeft(); return; }
    int mib = (int) state.tankHealth();
    if (mib == 0) { if (held != null) api.moveRight(); else api.moveLeft(); return; }
    held = new byte[mib * 1024 * 1024];
    for (int i = 0; i < held.length; i += 4096) held[i] = 1;
    api.shoot();
  }
}`;
async function measure(phase,activeWorker=false){
  const info=await chrome.send('SystemInfo.getProcessInfo',{},undefined,5000);
  const ids=info.processInfo.map(p=>Number(p.id)).filter(id=>Number.isSafeInteger(id)&&id>4);
  const privateBytes=Number(execFileSync('powershell.exe',['-NoProfile','-Command',
    `(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Measure-Object PrivateMemorySize64 -Sum).Sum`],{encoding:'utf8',windowsHide:true}).trim());
  let workerHeap;
  if(activeWorker){
    const target=[...chrome.targets.values()].findLast(target=>target.alive&&target.type==='worker');
    if(target)try{workerHeap=await chrome.send('Runtime.getHeapUsage',{},target.sessionId,1500);}catch(error){workerHeap={error:error.message};}
  }
  const mainHeap=await chrome.send('Runtime.getHeapUsage',{},page.target.sessionId,1500);
  const sample={phase,privateMiB:privateBytes/1024/1024,workerHeap,mainHeap};
  report.samples.push(sample);return sample;
}
async function startSampler(){
  const info=await chrome.send('SystemInfo.getProcessInfo',{},undefined,5000);
  const root=info.processInfo.find(p=>p.type==='browser');assert.ok(root);
  const browserId=Number(root.id);assert.ok(Number.isSafeInteger(browserId)&&browserId>4);
  const script=`$rootId=${browserId};$browser=Get-CimInstance Win32_Process -Filter "ProcessId=$rootId";
    if($browser.CommandLine -notmatch 'tankscript-cheerpj-'){throw 'Not the disposable test profile'};
    $created=$browser.CreationDate;Write-Output 'READY';$clock=[Diagnostics.Stopwatch]::StartNew();
    while($true){
      $owned=Get-CimInstance Win32_Process -Filter "ProcessId=$rootId OR ParentProcessId=$rootId";
      $current=$owned|Where-Object ProcessId -eq $rootId;
      if(!$current -or $current.CreationDate -ne $created){break};
      $ids=@($owned.ProcessId);$bytes=(Get-Process -Id $ids -ErrorAction SilentlyContinue | Measure-Object PrivateMemorySize64 -Sum).Sum;
      $free=(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024;
      $stop=$bytes -gt 1024MB -or $free -lt 1024 -or $clock.Elapsed.TotalSeconds -ge 240;
      @{milliseconds=$clock.ElapsedMilliseconds;privateMiB=$bytes/1MB;hostFreeMiB=$free;stopped=$stop}|ConvertTo-Json -Compress;
      if($stop){Stop-Process -Id $ids -ErrorAction SilentlyContinue;break};Start-Sleep -Milliseconds 250;
    }`;
  sampler=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  report.monitor=[];let buffer='',readyResolve,readyReject,errors='';
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  sampler.stdout.on('data',data=>{buffer+=data;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(line==='READY')readyResolve();else if(line)report.monitor.push(JSON.parse(line));}});
  sampler.stderr.on('data',data=>{errors+=data;});
  finishSampler=new Promise(resolve=>{sampler.on('exit',()=>{readyReject(Error(errors||'Monitor closed before readiness'));resolve();});});
  sampler.on('error',readyReject);await ready;
}
try{
  await server.listen();
  report.hostFreeMiB=Number(execFileSync('powershell.exe',['-NoProfile','-Command','(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024'],{encoding:'utf8',windowsHide:true}).trim());
  assert.ok(report.hostFreeMiB>=2560,'At least 2.5 GiB free host memory is required for this smaller lab');
  chrome=await launchChrome({pauseNewTargets:false});report.browser=chrome.version.Browser;
  await startSampler();
  page=await chrome.newPage('http://127.0.0.1:'+server.httpServer.address().port+'/__java-memory__');
  for(let attempt=0;attempt<100;attempt++){if(await page.evaluate('window.labReady===true'))break;await new Promise(r=>setTimeout(r,50));}
  const evaluate=expression=>page.evaluate(expression);
  await evaluate(`Promise.all([
    import('/frontend/src/game/tank-script/java/javaWorkerSession.js'),
    import('/frontend/src/game/tank-script/java/javaRuntimeAssets.js'),
    import('/frontend/src/game/tank-script/shared/tankScriptApi.js'),
    import('/frontend/src/game/tank-script/shared/tankScriptRunnerProtocol.js')
  ]).then(([sessions,assetModule,api,protocol])=>{
    window.createSession=()=>sessions.createJavaWorkerSession(undefined,{measureTimings:true});
    window.assets=assetModule.loadJavaRuntimeAssets();
    window.workerSource='const createTankScriptApi = '+api.createTankScriptApi.toString()+';'+String.fromCharCode(10)+'const actions = '+JSON.stringify(protocol.TANK_SCRIPT_ACTIONS)+';'+String.fromCharCode(10)+${JSON.stringify(instrumented)};
    window.ask=async(session,type,data,deadline)=>{const result=await session.request(type,data,deadline);if(result.error)throw Object.assign(new Error(result.error.message),result.error);return result;};
    window.snapshot={tankId:1,tankPosition:{x:1,y:1},tankRotation:0,tankHealth:0,arenaWidth:20,arenaHeight:20,allTanks:[],allBullets:[]};
    window.initializeCompiler=async()=>{window.session=createSession();const start=performance.now();await ask(session,'initializeCompiler',assets.then(assets=>({assets,workerSource})),30000);return {ms:performance.now()-start,linear:await ask(session,'inspectLinearMemory',{},500)};};
    window.compile=async(source)=>{const result=await ask(session,'compile',{source,sdk:${JSON.stringify(sdk)},entrypoint:${JSON.stringify(entrypoint)}},120000);if(result.wasm.buffer.byteLength>8*1024*1024)throw Error('Oversized artifact');return result;};
  })`);
  await measure('empty browser');
  report.compilerStarts=[];report.compiles=[];
  report.compilerStarts.push(await evaluate('initializeCompiler()'));
  await measure('compiler initialized',true);
  for(const [index,code] of [java,java.replace('api.rotateLeft()','api.rotateRight()'),java].entries()){
    const result=await evaluate(`compile(${JSON.stringify(code)}).then(result=>{window.compiled=result.wasm;return {ms:result.compilationMs,bytes:result.wasm.byteLength};})`);
    report.compiles.push(result);await measure('reused compiler compile '+(index+1),true);
  }
  const compilerCap=await evaluate("ask(session,'inspectLinearMemory',{growPages:256},500)");
  assert.equal(compilerCap.growError,'RangeError');check('16 MiB compiler linear-memory ceiling is enforced',compilerCap);
  await evaluate('session.dispose()');await measure('reused compiler terminated');
  report.compilerStarts.push(await evaluate('initializeCompiler()'));
  const fresh=await evaluate(`compile(${JSON.stringify(java)}).then(result=>({ms:result.compilationMs,bytes:result.wasm.byteLength}))`);
  report.freshCompile=fresh;await measure('fresh compiler compiled',true);await evaluate('session.dispose()');
  check('Three revisions reuse one compiler; fresh compiler comparison recorded',{starts:report.compilerStarts,compiles:report.compiles,fresh});
  await evaluate(`window.startTank=async()=>{
    window.session=createSession();await ask(session,'initializeRuntime',assets.then(a=>({workerSource,assets:{'compiler.csp-runtime.js':a['compiler.csp-runtime.js']},wasm:compiled,executionMs:100})),500);
    await ask(session,'construct',{},500);return ask(session,'inspectLinearMemory',{},500);
  };window.tick=state=>ask(session,'runTick',{snapshotJSON:JSON.stringify(state)},500);`);
  report.allocations=[];
  for(const mib of [8,16,32]){
    const initial=await evaluate('startTank()');assert.equal(initial.origin,'null');
    const cap=await evaluate("ask(session,'inspectLinearMemory',{growPages:64},500)");assert.equal(cap.growError,'RangeError');
    const before=await measure('before '+mib+' MiB array',true);
    const result=await evaluate(`tick({...snapshot,tankHealth:${mib}}).then(result=>({result}),error=>({error:error.code,message:error.message}))`);
    let retained,linear;
    if(!result.error){
      assert.equal(result.result.action,'shoot');retained=await evaluate('tick(snapshot)');assert.equal(retained.action,'moveRight');
      linear=await evaluate("ask(session,'inspectLinearMemory',{},500)");assert.equal(linear.bytes,initial.bytes);
    }else await evaluate('session.dispose()');
    const after=await measure('after '+mib+' MiB array',!result.error);
    report.allocations.push({mib,initial,cap,result,retained,linear,before,after});
    await evaluate('session.dispose()');
  }
  assert.ok(report.allocations.some(item=>!item.result.error&&item.mib>report.runtimeLinearMaxMiB));
  check('Java arrays larger than the 4 MiB linear cap still allocate and retain state',report.allocations.map(({mib,result,linear})=>({mib,result,linear})));
  for(let i=0;i<6;i++){await evaluate('startTank()');const result=await evaluate('tick({...snapshot,tankRotation:90})');assert.equal(result.action,'rotateLeft');await evaluate('session.dispose()');}
  assert.equal(await evaluate('document.querySelectorAll(\'iframe[title="Experimental Java execution"]\').length'),0);
  await measure('six cached runtime resets, all frames removed');
  await new Promise(resolve=>setTimeout(resolve,5000));await measure('five seconds after termination, no forced GC');
  check('Repeated runtime reset and termination remove all frames',{});
  assert.match(await evaluate('workerSource'),/executionMs >= executionLimitMs/);
  assert.ok(!report.monitor.some(sample=>sample.stopped));report.status='PASS';
}catch(error){report.status='FAIL';report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{
  if(chrome)await chrome.close();
  if(sampler){sampler.kill();await finishSampler;}
  await server.close();
  await writeFile(new URL('./results/memory-containment.json',import.meta.url),JSON.stringify(report,null,2));
}
