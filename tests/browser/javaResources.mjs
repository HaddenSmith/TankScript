import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { launchChrome } from '../../experiments/java-cheerpj/chrome.mjs';

// Bounded abuse probes only. Never intentionally exhaust the machine's memory.
process.env.VITE_EXPERIMENTAL_JAVA='true';
const server=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{
  name:'java-resource-lab',enforce:'pre',configureServer(server){server.middlewares.use('/__java-resources__',(_req,res)=>{
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Java resource lab</title><h1>Disposable local resource test</h1><script type="module">import "/@vite/client";window.resourceReady=true;</script>');
  });},
}]});
await server.listen();
const origin='http://127.0.0.1:'+server.httpServer.address().port;
const report={measuredAt:new Date().toISOString(),method:'Disposable Chromium profile; bounded 16/64/128 MiB allocations; whole-profile memory, not a Java heap quota',checks:[],samples:[]};
const java=(body,fields='')=>'import tankscript.TankScript;public class MyTank{'+fields+' public void tick(TankScript.Snapshot s,TankScript api){'+body+'}}';
const healthy=java('ticks++;if(ticks%2==1)api.rotateLeft();else api.rotateRight();','private int ticks;');
let chrome;
const check=(name,detail)=>{report.checks.push({name,detail});console.log('PASS:',name);};
async function memory(){
  const info=await chrome.send('SystemInfo.getProcessInfo');
  const ids=info.processInfo.map(item=>Number(item.id)).filter(id=>Number.isSafeInteger(id)&&id>4);
  const privateBytes=Number(execFileSync('powershell.exe',['-NoProfile','-Command',
    `(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Measure-Object PrivateMemorySize64 -Sum).Sum`],{windowsHide:true,encoding:'utf8'}).trim());
  const workers=await chrome.memory();
  return {privateMiB:privateBytes/1024/1024,workerCount:workers.length,workers,ids};
}
async function monitoredTick(page,expression){
  const {ids}=await memory();
  let start;
  const ready=new Promise(resolve=>{start=resolve;});
  // The cutoff can terminate only process IDs reported by this disposable browser.
  const code=`$ids=@(${ids.join(',')});$rows=@();Write-Output 'READY';for($i=0;$i -lt 30;$i++){
    $bytes=(Get-Process -Id $ids -ErrorAction SilentlyContinue | Measure-Object PrivateMemorySize64 -Sum).Sum;
    $rows+=@{milliseconds=$i*100;privateMiB=$bytes/1MB};
    if($bytes -gt 1792MB){Stop-Process -Id $ids -ErrorAction SilentlyContinue;break};Start-Sleep -Milliseconds 100};ConvertTo-Json -InputObject $rows -Compress`;
  const sampler=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';sampler.stdout.on('data',data=>{output+=data.toString();if(output.includes('READY'))start();});
  const finished=new Promise((resolve,reject)=>{sampler.on('error',reject);sampler.on('exit',()=>resolve());});
  await ready;
  let result;
  try{result=await page.evaluate(expression);}finally{await finished;}
  const samples=JSON.parse(output.slice(output.indexOf('\n')+1));
  assert.ok(samples.every(sample=>sample.privateMiB<1792),'Disposable browser hit the 1.75 GiB safety cutoff');
  return {result,samples};
}
async function open(){
  const page=await chrome.newPage(origin+'/__java-resources__');
  for(let attempt=0;attempt<100;attempt++){
    if(await page.evaluate('window.resourceReady===true'))break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(await page.evaluate('window.resourceReady'),true);
  await page.evaluate(`import('/frontend/src/game/tank-script/java/javaTankRunner.js').then(module=>{
    window.create=module.createJavaTankRunner;window.usage=module.getJavaResourceUsage;
    window.state={tankId:1,tankPosition:{x:1,y:1},tankRotation:0,tankHealth:3,arenaWidth:20,arenaHeight:20,allTanks:[],allBullets:[]};
  })`);
  return page;
}
try{
  // The 1.75 GiB profile cutoff includes the browser itself, so check host headroom
  // before launching that profile rather than subtracting its baseline twice.
  const freeMiB=Number(execFileSync('powershell.exe',['-NoProfile','-Command','(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024'],{windowsHide:true,encoding:'utf8'}).trim());
  report.hostFreeMiB=freeMiB;
  assert.ok(freeMiB>3072,'At least 3 GiB free host memory is required for these bounded probes');
  chrome=await launchChrome({pauseNewTargets:false});report.browser=chrome.version.Browser;
  const page=await open();
  report.samples.push({phase:'empty browser',...await memory()});
  const cold=await page.evaluate(`(async()=>{const start=performance.now();window.actor=await create(${JSON.stringify(healthy)});const first=await actor.runTick(state);return {totalMs:performance.now()-start,timings:actor.timings,first};})()`);
  assert.equal(cold.first.action,'rotateLeft');report.cold=cold;
  report.samples.push({phase:'cold compiler finished, one runtime',...await memory()});
  await page.evaluate('actor.dispose()');
  const warm=await page.evaluate(`(async()=>{const start=performance.now();window.actors=[];for(let i=0;i<4;i++)actors.push(await create(${JSON.stringify(healthy)}));return {ms:performance.now()-start,timings:actors.map(actor=>actor.timings),usage:usage()};})()`);
  assert.equal(warm.usage.activeRunners,4);assert.ok(warm.timings.every(timing=>timing.compilationCached));report.warm=warm;
  const rejected=await page.evaluate(`create(${JSON.stringify(healthy)}).then(()=>({unexpected:true}),error=>({message:error.message,usage:usage()}))`);
  assert.match(rejected.message,/four Java tanks/);assert.equal(rejected.usage.activeRunners,4);
  check('Four workers per document, including direct callers; fifth rejected',rejected);
  const soak=await page.evaluate(`(async()=>{const durations=[];for(let tick=0;tick<1000;tick++){const start=performance.now();const commands=await Promise.all(actors.map(actor=>actor.runTick(state)));
    if(commands.some(command=>command.action!==(tick%2===0?'rotateLeft':'rotateRight')))throw Error('State or command changed');durations.push(performance.now()-start);}
    durations.sort((a,b)=>a-b);return {batches:1000,median:durations[500],p95:durations[950],usage:usage()};})()`);
  check('Four Java tanks retain independent fields for 1000 batches',soak);
  report.samples.push({phase:'four runtimes after 1000 batches',...await memory()});
  const second=await open();
  const tabs=await second.evaluate(`(async()=>{window.actors=[];for(let i=0;i<4;i++)actors.push(await create(${JSON.stringify(healthy)}));return usage();})()`);
  check('Two documents can still create eight runtimes: limits are not origin-wide',tabs);
  report.samples.push({phase:'two tabs with four runtimes each',...await memory()});
  await second.evaluate('Promise.all(actors.map(actor=>actor.dispose()))');await second.close();
  await page.evaluate('Promise.all(actors.map(actor=>actor.dispose()))');
  for(const size of [16,64,128]){
    const code=java(`if(bytes==null){bytes=new byte[${size}*1024*1024];for(int i=0;i<bytes.length;i+=4096)bytes[i]=1;api.shoot();}else if(bytes.length==${size}*1024*1024)api.moveLeft();`,'private byte[] bytes;');
    await page.evaluate(`(async()=>{window.actor=await create(${JSON.stringify(code)});return true;})()`);
    const before=await memory();
    const observed=await monitoredTick(page,`actor.runTick(state).then(command=>({command}),error=>({error:error.code,message:error.message}))`);
    const after=await memory();
    const again=await page.evaluate('actor.runTick(state).then(command=>({command}),error=>({error:error.code}))');
    report.samples.push({phase:'bounded allocation '+size+' MiB',before,observed,after,again});
    await page.evaluate('actor.dispose()');
    assert.equal(await page.evaluate('usage().activeRunners'),0);
    check('Bounded '+size+' MiB guest allocation measured; worker cleanup verified',{first:observed.result,second:again});
  }
  const hog=java('bytes=new byte[128*1024*1024];for(int i=0;i<bytes.length;i+=4096)bytes[i]=1;while(true){}','private byte[] bytes;');
  await page.evaluate(`(async()=>{window.actor=await create(${JSON.stringify(hog)});return true;})()`);
  const runaway=await monitoredTick(page,'actor.runTick(state).then(()=>({unexpected:true}),error=>({code:error.code,usage:usage()}))');
  assert.equal(runaway.result.code,'EXECUTION_TIMEOUT');assert.equal(runaway.result.usage.activeRunners,0);
  report.samples.push({phase:'128 MiB allocation then infinite loop',...runaway});
  check('Allocation before an infinite loop is externally terminated, not prevented',runaway.result);
  const bounded=await page.evaluate(`(async()=>{const before=usage();let message;try{await create('x'.repeat(100001));}catch(error){message=error.message;}return {before,after:usage(),message};})()`);
  assert.deepEqual(bounded.before,bounded.after);check('Oversized source rejected without starting workers',bounded);
  const resets=await page.evaluate(`(async()=>{let cachedStarts=0;for(let i=0;i<20;i++){const actor=await create(${JSON.stringify(healthy)});if(actor.timings.compilationCached)cachedStarts++;await actor.runTick(state);await actor.dispose();}return {...usage(),cachedStarts,frames:document.querySelectorAll('iframe[title="Experimental Java execution"]').length};})()`);
  assert.equal(resets.activeRunners,0);assert.equal(resets.frames,0);assert.equal(resets.cachedStarts,19);
  assert.ok(resets.cachedBytes<=8*1024*1024);check('Twenty starts/resets, nineteen cached, leave no frames and bounded cache',resets);
  report.samples.push({phase:'after repeated cleanup',...await memory()});
  await page.close();
  const ratePage=await open();
  const busy=await ratePage.evaluate(`(async()=>{const pending=create(${JSON.stringify(healthy)});const second=await create(${JSON.stringify(healthy+'// another')}).then(()=>null,error=>error.message);const actor=await pending;await actor.dispose();return {second,usage:usage()};})()`);
  assert.match(busy.second,/compiler is busy/);check('A second compiler is rejected, not queued or duplicated',busy);
  const rate=await ratePage.evaluate(`(async()=>{const errors=[];for(let i=0;i<8;i++){try{await create('public class MyTank { broken syntax; } // '+i);}catch(error){errors.push(error.message);}}return {errors,usage:usage()};})()`);
  assert.match(rate.errors.at(-1),/eight new compilations/);assert.equal(rate.usage.activeCompilers,0);assert.equal(rate.usage.activeRunners,0);
  check('Compilation frequency includes failures and blocks the ninth compiler start',rate);
  report.samples.push({phase:'after repeated compiler failures',...await memory()});
  await ratePage.close();
  const sourcePage=await open();
  const large=healthy+'/*'+'x'.repeat(100000-healthy.length-4)+'*/';
  const nearLimit=await sourcePage.evaluate(`(async()=>{const actor=await create(${JSON.stringify(large)});const command=await actor.runTick(state);await actor.dispose();return {command,usage:usage()};})()`);
  assert.equal(nearLimit.command.action,'rotateLeft');check('A real 100000-character source compiles at the existing source limit',nearLimit);
  const constants=java('api.shoot();',Array.from({length:17},(_,i)=>'private static final String S'+i+'='+(i===0?'"x"':'S'+(i-1)+'+S'+(i-1))+';').join(''));
  const folding=await sourcePage.evaluate(`create(${JSON.stringify(constants)}).then(async actor=>{await actor.dispose();return {unexpected:true};},error=>({message:error.message,usage:usage()}))`);
  assert.match(folding.message,/constant|string|UTF8/i);assert.equal(folding.usage.activeCompilers,0);
  check('Bounded exponential constant expansion reports compiler diagnostics and cleans up',folding);
  const collision=java('api.shoot();')+' class TankEntrypoint {}';
  const duplicate=await sourcePage.evaluate(`create(${JSON.stringify(collision)}).then(()=>null,error=>error.message)`);
  assert.match(duplicate,/duplicate class/);check('Player source cannot replace the trusted entrypoint',duplicate);
  const processor='import tankscript.TankScript;import javax.annotation.processing.*;import javax.lang.model.element.*;import java.util.Set;'+
    'public class MyTank extends AbstractProcessor { public boolean process(Set<? extends TypeElement> a,RoundEnvironment r){throw new RuntimeException("PROCESSOR_RAN");}'+
    'public void tick(TankScript.Snapshot state,TankScript api){api.shoot();}}';
  const processing=await sourcePage.evaluate(`(async()=>{try{const actor=await create(${JSON.stringify(processor)});const command=await actor.runTick(state);await actor.dispose();return {command};}catch(error){return {message:error.message};}})()`);
  assert.doesNotMatch(processing.message??'',/PROCESSOR_RAN/);
  check('Source-defined annotation processor is not automatically executed',processing);
  await sourcePage.close();
  report.status='PASS';
}catch(error){report.status='FAIL';report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{
  if(chrome)await chrome.close();await server.close();
  await mkdir(new URL('../../experiments/java-teavm/results/',import.meta.url),{recursive:true});
  await writeFile(new URL('../../experiments/java-teavm/results/public-resources.json',import.meta.url),JSON.stringify(report,null,2));
}
