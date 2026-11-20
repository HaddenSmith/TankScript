import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, preview } from 'vite';
import { createServer as createHttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { launchChrome } from '../../experiments/java-cheerpj/chrome.mjs';

const production=process.argv.includes('--production');
const functionalOnly=process.argv.includes('--functional-only');
const disabled=production||process.argv.includes('--disabled');
process.env.VITE_EXPERIMENTAL_JAVA=process.argv.includes('--disabled')?'false':'true';
const requests=[];
const community=[['javascript','Script'],['typescript','Typed'],['python','Snake']].map(([language,name])=>({
  id:name,name,ownerUsername:'Dummy',language,color:'#317d84',
  code:language==='python'?'rotate_right()':language==='typescript'?'const ready: boolean = true; if(ready) rotateRight();':'rotateRight();',
}));
const api={name:'java-battle-dummy-api',enforce:'pre',
  configurePreviewServer(server){return api.configureServer(server);},
  configureServer(server){server.middlewares.use((req,res,next)=>{
    const url=new URL(req.url,'http://test.invalid');
    if(!url.pathname.startsWith('/api/'))return next();
    requests.push({path:url.pathname,method:req.method});
    res.setHeader('Content-Type','application/json');
    if(url.pathname==='/api/auth/me')return res.end(JSON.stringify({username:'Dummy'}));
    if(url.pathname==='/api/tanks/all')return res.end(JSON.stringify(community));
    res.writeHead(403);res.end('{}');
  });},
};
const fixture=createHttpServer();const sockets=new WebSocketServer({server:fixture});
sockets.on('connection',socket=>socket.send(JSON.stringify({type:'online-count',count:1})));
await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
const serving={host:'127.0.0.1',port:0,proxy:{'/ws':{target:'ws://127.0.0.1:'+fixture.address().port,ws:true}}};
const server=production?await preview({preview:serving,plugins:[api],logLevel:'error'})
  :await createServer({server:serving,plugins:[api],logLevel:'error'});
if(!production)await server.listen();
const origin='http://127.0.0.1:'+server.httpServer.address().port;
const temp=await mkdtemp(path.join(os.tmpdir(),'tankscript-java-battle-'));
const report={measuredAt:new Date().toISOString(),platform:process.platform,checks:[],performance:[]};
const check=(name,detail={})=>{report.checks.push({name,passed:true,detail});console.log('PASS:',name);};
const java=(body,fields='')=>'import tankscript.TankScript; public class MyTank {'+fields+' public void tick(TankScript.Snapshot s,TankScript api){'+body+'}}';
const source=java('ticks++; if(ticks%2==1) api.rotateLeft(); else api.rotateRight(); api.shoot();','private int ticks;');
let chrome,page;
const evaluate=text=>page.evaluate(text,180_000);
async function until(expression){
  for(let i=0;i<1500;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}
  throw new Error('Timed out: '+expression+'; '+await evaluate('document.body.innerText.slice(-1200)'));
}
async function open(){
  chrome=await launchChrome();report.browser=chrome.version.Browser;
  page=await chrome.newPage(origin+'/battle');
  await until('!!document.querySelector(".battle-page")');
  const runnerURL=production
    ? '/assets/'+(await readdir(new URL('../../dist/assets/',import.meta.url))).find(name=>name.startsWith('tankScriptWorkerRunner-'))
    : '/frontend/src/game/tank-script/shared/tankScriptWorkerRunner.js';
  await evaluate(`import(${JSON.stringify(runnerURL)}).then(module=>window.createRunner=module.createTankScriptBattleRunner)`);
  if(!disabled)await evaluate(`import('/frontend/src/game/battleController.js').then(module=>window.createEngine=module.createBattleFromSelectedTanks)`);
}
async function memory(){
  const workers=await chrome.memory();
  const info=await chrome.send('SystemInfo.getProcessInfo');
  const ids=info.processInfo.map(item=>Number(item.id)).filter(Number.isSafeInteger);
  let processes=[];
  if(process.platform==='win32'){
    processes=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',
      `Get-Process | Where-Object { $_.Id -in @(${ids.join(',')}) } | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`],{windowsHide:true,encoding:'utf8'}));
    if(!Array.isArray(processes))processes=[processes];
  }
  return {workers,processPrivateBytes:processes.reduce((sum,p)=>sum+p.PrivateMemorySize64,0),
    processWorkingSetBytes:processes.reduce((sum,p)=>sum+p.WorkingSet64,0)};
}
try{
  if(disabled){
    await open();
    assert.equal(await evaluate('!!document.querySelector("#java-tank-file")'),false);
    const rejected=await evaluate(`createRunner([{tankId:1,source:${JSON.stringify(source)},language:'java'}]).then(()=>false,error=>error.message)`);
    assert.match(rejected,/only available in development/);
    assert.equal(chrome.network.some(item=>item.url.includes('/__java-debugger__/')),false);
    check(production?'Production hides and rejects Java battles':'Normal development hides and rejects Java battles');
  }else{
    // Each count gets a new browser profile. Warm runs reuse only assets/compiled code,
    // never mutable Java instances. The Vite server/OS caches are not cleared.
    for(const count of functionalOnly?[]:[1,4,12]){
      await open();const baseline=await memory();
      await evaluate(`window.javaSource=${JSON.stringify(source)};window.startMeasured=async(count)=>{
        const tanks=Array.from({length:count},(_,i)=>({tankId:i+1,language:'java',source:javaSource}));
        const start=performance.now();window.runner=await createRunner(tanks);const initialized=performance.now();
        window.states=tanks.map(t=>({tankId:t.tankId,tankPosition:{x:1,y:1},tankRotation:0,tankHealth:3,arenaWidth:20,arenaHeight:20,
          allTanks:tanks.map(t=>({id:t.tankId,name:'Java',x:t.tankId,y:1,rotation:0,health:3})),allBullets:[]}));
        const reply=await runner.runTick(states);if(reply.results.some(r=>r.error||r.command?.action!=='rotateLeft'))throw Error(JSON.stringify(reply));
        return {startupMs:initialized-start,firstTickMs:performance.now()-initialized,totalFirstTickMs:performance.now()-start,initialization:runner.initialization};
      };window.sampleTicks=async(n,stress=false)=>{
        const times=[],failures=new Map();for(let i=0;i<n;i++){
          const start=performance.now(),reply=await runner.runTick(states);
          for(const result of reply.results){
            if(result.error){
              if(!stress||result.error.code!=='EXECUTION_TIMEOUT')throw Error(JSON.stringify(reply));
              if(!failures.has(result.tankId))failures.set(result.tankId,{tankId:result.tankId,batch:i,...result.error});
            }else{
              if(failures.has(result.tankId))throw Error('Disabled Java tank resumed unexpectedly');
              if(!['rotateLeft','rotateRight'].includes(result.command?.action))throw Error('Invalid action');
            }
          }
          times.push(performance.now()-start);
        }times.sort((a,b)=>a-b);return {batches:n,medianMs:times[Math.floor(n/2)],p95Ms:times[Math.floor(n*.95)],maxMs:times[n-1],deadlineFailures:[...failures.values()]};
      };`);
      const cold=await evaluate(`startMeasured(${count})`);
      const coldMemory=await memory();cold.ticks=await evaluate('sampleTicks(100)');
      assert.equal(cold.initialization.filter(item=>!item.timings.compilationCached).length,1);
      await evaluate('runner.dispose()');
      const warm=await evaluate(`startMeasured(${count})`);
      assert.equal(warm.initialization.every(item=>item.timings.compilationCached),true);
      warm.ticks=await evaluate('sampleTicks(100)');
      const beforeSoak=await memory();
      // Saturated stress probes record correctly contained deadline failures;
      // ordinary startup/100-tick checks above still require every tank to succeed.
      const soak=await evaluate('sampleTicks(5000,true)');
      const afterSoak=await memory();
      assert.equal(afterSoak.workers.length,count-soak.deadlineFailures.length);
      const extraSoak=count===12?await evaluate('sampleTicks(5000,true)'):undefined;
      const afterExtraSoak=count===12?await memory():undefined;
      // Diagnostic only: GC samples distinguish live heaps from retained allocator pages.
      for(const target of chrome.targets.values())if(target.alive && (target.type==='worker'||target.type==='page')){
        await chrome.send('HeapProfiler.collectGarbage',{},target.sessionId);
      }
      const afterGC=await memory();
      await evaluate('runner.dispose()');
      await until('document.querySelectorAll(\'iframe[title="Experimental Java execution"]\').length===0');
      const afterDispose=await memory();assert.equal(afterDispose.workers.length,0);
      const result={count,baseline,cold,coldMemory,warm,beforeSoak,soak,afterSoak,extraSoak,afterExtraSoak,afterGC,afterDispose};
      report.performance.push(result);
      check('Fresh-profile and warm '+count+' Java tanks; 5,000-batch resource soak',{
        coldFirstTickMs:cold.totalFirstTickMs,warmFirstTickMs:warm.totalFirstTickMs,p95Ms:warm.ticks.p95Ms,
        privateMiB:afterSoak.processPrivateBytes/1024/1024,deadlineFailures:soak.deadlineFailures,extraDeadlineFailures:extraSoak?.deadlineFailures});
      await chrome.close();chrome=undefined;
    }
    await open();
    // Genuine adapters plus the unchanged BattleEngine, including simultaneous movement.
    for(const languages of [['java','java'],['java','javascript'],['java','typescript'],['java','python'],['java','javascript','typescript','python']]){
      const tanks=languages.map((language,index)=>{
        const action=index%2===0?'moveRight':'moveLeft';
        return {id:String(index),name:language,language,color:'#317d84',
          code:language==='java'?java(`ticks++; if(ticks<=2)api.${action}();else api.rotateLeft();api.shoot();`,'private int ticks;')
            :language==='python'?(index%2===0?'move_right()':'move_left()'):language==='typescript'?'const ready: boolean=true;if(ready)'+action+'();':action+'();'};
      });
      const result=await evaluate(`(async()=>{const tanks=${JSON.stringify(tanks)};const engine=createEngine(tanks,12);const starting=engine.arena.tanks.map(t=>t.x);
        const actor=await createRunner(tanks.map((t,i)=>({tankId:i+1,source:t.code,language:t.language})));try{
          for(let tick=0;tick<2;tick++){const before=engine.getTankScriptStates();const result=await actor.runTick([...before].reverse());
            if(result.results.some(r=>r.error))throw Error(JSON.stringify(result));
            if(engine.arena.tanks.some((t,i)=>t.x!==starting[i]+tick*(i%2===0?1:-1)))throw Error('engine advanced before all commands');
            engine.resolveTick(Object.fromEntries(result.results.map(r=>[r.tankId,r.command?.action])));}
          const third=await actor.runTick(engine.getTankScriptStates());return {positions:engine.arena.tanks.map(t=>t.x),starting,third};
        }finally{await actor.dispose();}})()`);
      assert.deepEqual(result.positions,result.starting.map((x,i)=>x+2*(i%2===0?1:-1)));
      for(const entry of result.third.results)if(languages[entry.tankId-1]==='java')assert.equal(entry.command.action,'rotateLeft');
      check('Real battle: '+languages.join(' + '),result);
    }
    for(const [name,code,expected] of [
      ['compile error','public class MyTank { broken syntax; }','COMPILE_ERROR'],
      ['runtime exception',java('api.shoot();throw new IllegalStateException("dummy failure");'),'RUNTIME_ERROR'],
      ['infinite tick',java('while(true){}'),'EXECUTION_TIMEOUT'],
      ['constructor hang',java('','public MyTank(){while(true){}}'),'EXECUTION_TIMEOUT'],
      ['static initializer hang',java('','static{if(hang())while(true){}}private static boolean hang(){return true;}'),'EXECUTION_TIMEOUT'],
    ]){
      const result=await evaluate(`(async()=>{const actor=await createRunner([{tankId:1,language:'java',source:${JSON.stringify(code)}},{tankId:2,language:'java',source:${JSON.stringify(source)}},{tankId:3,source:'rotateRight();'}]);
        const snapshot={tankPosition:{x:1,y:1},tankRotation:0,tankHealth:3,arenaWidth:8,arenaHeight:8,allTanks:[],allBullets:[]};try{
          const replies=[];for(let i=0;i<3;i++)replies.push(await actor.runTick([1,2,3].map(tankId=>({...snapshot,tankId}))));return replies;
        }finally{await actor.dispose();}})()`);
      for(const reply of result){assert.equal(reply.results[0].error.code,expected);assert.equal(reply.results[2].command.action,'rotateRight');}
      assert.deepEqual(result.map(reply=>reply.results[1].command.action),['rotateLeft','rotateRight','rotateLeft']);
      check('Healthy Java and QuickJS survive '+name,result);
    }
    const beforeRestarts=await memory();
    const restarts=await evaluate(`(async()=>{
      const tanks=[{id:'j',name:'Java',language:'java',code:${JSON.stringify(source)},color:'#317d84'},...${JSON.stringify(community)}];
      const ticks=[];for(let battle=0;battle<10;battle++){
        const engine=createEngine(tanks,12),actor=await createRunner(tanks.map((tank,i)=>({tankId:i+1,source:tank.code,language:tank.language})));
        try{let result=null;for(let tick=0;tick<1000&&!result;tick++){
          const reply=await actor.runTick(engine.getTankScriptStates());if(reply.results.some(r=>r.error))throw Error(JSON.stringify(reply));
          result=engine.resolveTick(Object.fromEntries(reply.results.map(r=>[r.tankId,r.command?.action])));
        }if(result?.reason!=='stalemate')throw Error(JSON.stringify(result));ticks.push(engine.getTickCount());
        }finally{await actor.dispose();}
      }return ticks;
    })()`);
    assert.deepEqual(restarts,Array(10).fill(125));
    const afterRestarts=await memory();assert.equal(afterRestarts.workers.length,0);
    check('Ten complete four-language battles retain normal rules and clean up on each end',{ticks:restarts,beforeRestarts,afterRestarts});
    // Exercise file loading and the actual page's pause/resume/reset/end lifecycle.
    const filename=path.join(temp,'Local.java');await writeFile(filename,source);
    async function loadFile(){
      const document=await chrome.send('DOM.getDocument',{},page.target.sessionId);
      const input=await chrome.send('DOM.querySelector',{nodeId:document.root.nodeId,selector:'#java-tank-file'},page.target.sessionId);
      await chrome.send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[filename]},page.target.sessionId);
    }
    await loadFile();
    await until('document.body.innerText.includes("Local (Java — experimental)")');
    await evaluate(`for(const label of ['Local (Java — experimental)','Script (Dummy)','Typed (Dummy)','Snake (Dummy)'])document.querySelector('button[aria-label="Add one '+label+'"]')?.click();`);
    await evaluate('const speed=document.querySelector("#battle-speed");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(speed,"0");speed.dispatchEvent(new Event("input",{bubbles:true}));');
    const click=text=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
    await click('Start Battle');await until('document.body.innerText.includes("TICK 2 /") || document.body.innerText.includes("TICK 3 /")');
    await click('Pause Battle');const paused=await evaluate('document.querySelector(".battle-tick-count").textContent.trim()');
    await new Promise(resolve=>setTimeout(resolve,650));assert.equal(await evaluate('document.querySelector(".battle-tick-count").textContent.trim()'),paused);
    await click('Resume Battle');await until('!document.body.innerText.includes('+JSON.stringify(paused)+')');
    await click('Reset Battle');await until('document.querySelectorAll(\'iframe[title="Experimental Java execution"],iframe[title="Python execution"]\').length===0');
    check('Actual four-language Battle page: local file, pause, resume and reset');
    await click('Start Battle');await until('document.body.innerText.includes("BATTLE COMPLETE")');
    await until('document.querySelectorAll(\'iframe[title="Experimental Java execution"],iframe[title="Python execution"]\').length===0');
    check('Actual battle completes at the unchanged stalemate limit and cleans up',await evaluate('document.querySelector("#realtime-battle-feed").innerText.slice(-400)'));
    await click('Reset Battle');
    await writeFile(filename,source+'\n// new revision for cancellation');
    await loadFile();
    await until('document.querySelectorAll(\'[aria-label="Add one Local (Java — experimental)"]\').length===2');
    await evaluate('document.querySelectorAll(\'[aria-label="Add one Local (Java — experimental)"]\')[1].click()');
    await click('Start Battle');await until('document.body.innerText.includes("Compiling Java")');
    await click('Reset Battle');await until('document.querySelectorAll(\'iframe[title="Experimental Java execution"],iframe[title="Python execution"]\').length===0');
    check('Reset cancels real Java compilation and all peers');
    assert.equal(requests.some(request=>request.method!=='GET'),false);
  }
  report.status='PASS';
}catch(error){report.status='FAIL';report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{
  report.requests=requests;if(chrome){report.errors=chrome.errors;await chrome.close();}
  await mkdir(new URL('../../experiments/java-teavm/results/',import.meta.url),{recursive:true});
  await writeFile(new URL('../../experiments/java-teavm/results/battle-'+(production?'production':disabled?'disabled':functionalOnly?'functional':'integration')+'.json',import.meta.url),JSON.stringify(report,null,2));
  await server.close();for(const socket of sockets.clients)socket.terminate();
  await new Promise(resolve=>sockets.close(resolve));await new Promise(resolve=>fixture.close(resolve));
  if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('tankscript-java-battle-'))throw Error('Unexpected fixture directory');
  await rm(temp,{recursive:true,force:true});
}
