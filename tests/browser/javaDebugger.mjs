import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, preview } from 'vite';
import { createServer as createHttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { launchChrome } from '../../experiments/java-cheerpj/chrome.mjs';

// Local dummy authentication only; never connect this test to a real backend.
const requests = [];
const testApi = {
  name: 'java-debugger-test-api', enforce: 'pre',
  configurePreviewServer(server) { return testApi.configureServer(server); },
  configureServer(server) {
    server.middlewares.use((request,response,next) => {
      const path = new URL(request.url,'http://test.invalid').pathname;
      if (!path.startsWith('/api/') && path !== '/__java-test-probe__') return next();
      requests.push({path,method:request.method});
      response.setHeader('Content-Type','application/json');
      if(path==='/api/auth/me') {
        response.setHeader('Set-Cookie',['java_debug_dummy=dummy-only; HttpOnly; SameSite=Strict; Path=/', 'java_debug_visible=dummy-visible; SameSite=Strict; Path=/']);
        return response.end(JSON.stringify({username:'Java_Pilot'}));
      }
      if(path==='/api/tanks' && request.method==='GET') return response.end('[]');
      if(path==='/api/java-private') return response.end(JSON.stringify({canary:'dummy-account-only'}));
      response.writeHead(403); response.end('{}');
    });
  },
};
const production = process.argv.includes('--production');
const disabled = production || process.argv.includes('--disabled');
// Production must ignore even an explicitly enabled environment variable.
process.env.VITE_EXPERIMENTAL_JAVA = process.argv.includes('--disabled') ? 'false' : 'true';
const fixture = createHttpServer();
const sockets = new WebSocketServer({server:fixture});
sockets.on('connection', socket => socket.send(JSON.stringify({type:'online-count',count:1})));
await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
const serving = {host:'127.0.0.1',port:0,proxy:{'/ws':{target:'ws://127.0.0.1:'+fixture.address().port,ws:true}}};
const server = production
  ? await preview({preview:serving,plugins:[testApi],logLevel:'error'})
  : await createServer({server:serving,plugins:[testApi],logLevel:'error'});
if(!production) await server.listen();
const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
const chrome = await launchChrome();
const report = {measuredAt:new Date().toISOString(),browser:chrome.version.Browser,checks:[]};
const check = (name,detail) => {report.checks.push({name,passed:true,detail}); console.log('PASS:',name);};
try {
  const page = await chrome.newPage(origin+'/tank-editor');
  await chrome.send('Emulation.setDeviceMetricsOverride',{width:1280,height:1100,deviceScaleFactor:1,mobile:false},page.target.sessionId);
  const evaluate = text => page.evaluate(text,180_000);
  async function until(expression) {
    for(let attempt=0;attempt<1500;attempt++) {
      if(await evaluate(expression))return;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error('Timed out: '+expression+'; page: '+await evaluate('document.body.innerText.slice(-1200)'));
  }
  async function setCode(code, language='java') {
    await evaluate(`import(${JSON.stringify(monacoURL)}).then(monaco=>monaco.editor.getModels().find(model=>model.getLanguageId()===${JSON.stringify(language)}).setValue(${JSON.stringify(code)}))`);
    await until('document.querySelector(\'input[name="tank-code"]\')?.value === '+JSON.stringify(code));
  }
  async function generate() {
    await evaluate('document.querySelector(".debugger-generate-button").click()');
    await new Promise(resolve=>setTimeout(resolve,50));
    await until('!document.querySelector(".debugger-generate-button").disabled');
    return evaluate('document.querySelector(".debugger-command-output").textContent');
  }
  await until('!!document.querySelector(".monaco-editor textarea")');
  await evaluate('document.querySelector("#tank-language").click()');
  const label = await evaluate('Array.from(document.querySelectorAll(\'[role="option"]\')).find(node=>node.textContent.startsWith("Java —"))?.textContent');
  if(disabled) {
    assert.equal(label,'Java — coming soon');
    assert.equal(await evaluate('Array.from(document.querySelectorAll(\'[role="option"]\')).find(node=>node.textContent.startsWith("Java —")).getAttribute("aria-disabled")'),'true');
    await evaluate('Array.from(document.querySelectorAll(\'[role="option"]\')).find(node=>node.textContent.startsWith("Java —")).click()');
    assert.equal(await evaluate('document.querySelector("#tank-language-selected").textContent'),'JavaScript');
    assert.equal(chrome.network.some(request=>request.url.includes('/__java-debugger__/')),false);
    check(production?'Production ignores the Java opt-in flag':'Normal development keeps Java disabled',{label});
  } else {
  assert.match(label,/experimental/);
  await evaluate('Array.from(document.querySelectorAll(\'[role="option"]\')).find(node=>node.textContent.startsWith("Java —")).click()');
  await until('document.querySelector(\'input[name="tank-code"]\')?.value.startsWith("import tankscript.")');
  const monacoURL = chrome.network.find(item => /\/monaco-editor\.js\?/.test(item.url))?.url;
  assert.ok(monacoURL, 'Monaco module must be loaded by the real editor');
  const modes = await evaluate(`import(${JSON.stringify(monacoURL)}).then(monaco=>monaco.editor.getModels().map(model=>model.getLanguageId()))`);
  assert.ok(modes.includes('java'));
  assert.equal(await evaluate('document.querySelector(".tank-save-button").disabled'),true);
  await evaluate('document.querySelector("#tank-debugger-tab").click()');
  const starter = await generate();
  assert.match(starter,/"action": "shoot"/);
  check('Actual Monaco Java starter compiles and runs in the Debugger',{label,starter});
  await setCode(`import tankscript.TankScript;
import tankscript.TankScript.Snapshot;
public class MyTank {
  private int ticks;
  public void tick(Snapshot state, TankScript api) {
    ticks++;
    if(ticks % 2 == 1) api.shoot(); else api.moveRight();
    api.moveDown();
  }
}`);
  assert.match(await generate(),/"action": "shoot"/);
  assert.match(await generate(),/"action": "moveRight"/);
  check('Repeated Generate Command retains Java fields and the first action wins',{});
  await setCode('public class MyTank { broken syntax; }');
  const error=await generate();
  assert.match(error,/line 1/);
  check('Compilation errors show source lines',error);

  // Cancel a new compilation through the real UI, then edit while another is pending.
  await setCode('import tankscript.TankScript; public class MyTank { public void tick(TankScript.Snapshot s, TankScript api) { api.rotateLeft(); } }');
  await evaluate('document.querySelector(".debugger-generate-button").click()');
  await until('document.querySelector(".debugger-command-output").textContent.includes("Compiling Java")');
  await evaluate('Array.from(document.querySelectorAll("button")).find(button=>button.textContent==="Cancel Java").click()');
  await until('document.querySelectorAll(\'iframe[title="Experimental Java execution"]\').length===0');
  assert.match(await evaluate('document.querySelector(".debugger-command-output").textContent'),/cancelled/);
  await evaluate('document.querySelector(".debugger-generate-button").click()');
  await until('document.querySelector(".debugger-command-output").textContent.includes("Compiling Java")');
  await setCode('public class MyTank { edited while compiling; }');
  await until('document.querySelectorAll(\'iframe[title="Experimental Java execution"]\').length===0');
  assert.match(await evaluate('document.querySelector(".debugger-command-output").textContent'),/code changed/);
  check('Cancel and code edits terminate pending Java compilation',{});

  // Compile once more and inspect the active environment without adding guest test hooks.
  const simple = 'import tankscript.TankScript; public class MyTank { public void tick(TankScript.Snapshot s, TankScript api) { api.shoot(); } }';
  await setCode(simple);
  assert.match(await generate(),/"action": "shoot"/);
  const policy = await evaluate('document.querySelector(\'iframe[title="Experimental Java execution"]\').srcdoc');
  assert.match(policy,/wasm-unsafe-eval/); assert.doesNotMatch(policy,/'unsafe-eval'/);
  assert.match(policy,/connect-src 'none'/);
  assert.equal(await evaluate('document.querySelector(\'iframe[title="Experimental Java execution"]\').getAttribute("sandbox")'),'allow-scripts');
  const worker = Array.from(chrome.targets.values()).find(target=>target.alive && target.type==='worker' && target.url.startsWith('blob:null/'));
  assert.ok(worker,'The Java runtime must live in an opaque-origin worker');
  const baselinePrivate = requests.filter(request=>request.path==='/api/java-private').length;
  await evaluate('localStorage.setItem("java-debug-dummy", "app-only"); fetch("/api/java-private").then(response=>response.json())');
  const probe = await chrome.send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,
    // CDP otherwise defaults to bypassing CSP for eval(), which invalidates the test.
    allowUnsafeEvalBlockedByCSP:false,
    expression:`(async()=>{
      const result={origin:self.origin,localStorage:typeof localStorage,cookie:typeof document};
      for(const [name,fn] of [['eval',()=>eval('1+1')],['Function',()=>new Function('return 2')()]]){
        try{fn();result[name]='ALLOWED';}catch(error){result[name]=error.name;}
      }
      try{await fetch(${JSON.stringify(origin+'/api/java-private')},{credentials:'include'});result.fetch='ALLOWED';}catch(error){result.fetch=error.name;}
      try{await fetch(${JSON.stringify(origin+'/__java-test-probe__')},{method:'POST',mode:'no-cors',body:'dummy'});result.post='ALLOWED';}catch(error){result.post=error.name;}
      try{const socket=new WebSocket(${JSON.stringify(origin.replace('http:','ws:')+'/__java-test-probe__')});result.websocket=await new Promise(resolve=>{socket.onopen=()=>{socket.close();resolve('ALLOWED');};socket.onerror=()=>resolve('blocked');});}catch(error){result.websocket=error.name;}
      try{result.indexedDB=await new Promise(resolve=>{const r=indexedDB.open('java-debug-dummy');r.onsuccess=()=>{r.result.close();resolve('ALLOWED');};r.onerror=()=>resolve(r.error.name);});}catch(error){result.indexedDB=error.name;}
      try{await navigator.storage.getDirectory();result.opfs='ALLOWED';}catch(error){result.opfs=error.name;}
      return result;
    })()`},worker.sessionId);
  assert.equal(probe.exceptionDetails,undefined);
  const security=probe.result.value;
  assert.equal(security.origin,'null');
  assert.equal(security.localStorage,'undefined'); assert.equal(security.cookie,'undefined');
  for(const name of ['eval','Function','fetch','post','websocket','indexedDB','opfs']) assert.notEqual(security[name],'ALLOWED',name);
  assert.equal(security.eval,'EvalError'); assert.equal(security.Function,'EvalError');
  assert.equal(requests.filter(request=>request.path==='/api/java-private').length,baselinePrivate+1);
  assert.equal(requests.filter(request=>request.path==='/__java-test-probe__').length,0);
  check('Opaque worker blocks JavaScript eval, network, cookies and persistent storage',security);

  await evaluate('document.querySelector("#tank-reference-tab").click()');
  await until('document.querySelectorAll(\'iframe[title="Experimental Java execution"]\').length===0');
  check('Leaving the Debugger removes Java workers and frames',{});

  // Use the same public adapter as the Debugger to exercise the complete data contract.
  await evaluate(`import('/frontend/src/game/tank-script/shared/tankScriptWorkerRunner.js').then(module=>window.createRunner=module.createTankScriptWorkerRunner)`);
  const state={tankId:0,tankPosition:{x:1,y:2},tankRotation:90,tankHealth:3,arenaWidth:8,arenaHeight:8,
    allTanks:[{id:0,name:'quote" newline\n 🛡',x:1,y:2,rotation:90,health:3}],
    allBullets:[{id:2,ownerId:0,x:2.5,y:2,rotation:90}]};
  await evaluate(`window.snapshot=${JSON.stringify(state)}`);
  const java = (body,fields='')=>'import tankscript.TankScript; public class MyTank { '+fields+' public void tick(TankScript.Snapshot s, TankScript api) { '+body+' } }';
  const contract = java(`
    if(s.tankId()!=0 || s.tankPosition().x()!=1 || s.tankPosition().y()!=2 || s.tankRotation()!=90 || s.tankHealth()!=3 || s.arenaWidth()!=8 || s.arenaHeight()!=8) throw new IllegalStateException("scalar snapshot");
    var tank=s.allTanks().get(0); var bullet=s.allBullets().get(0);
    if(tank.id()!=0 || !tank.name().contains("🛡") || !tank.name().contains("\\n") || tank.x()!=1 || tank.y()!=2 || tank.rotation()!=90 || tank.health()!=3) throw new IllegalStateException("tank snapshot");
    if(bullet.id()!=2 || bullet.ownerId()!=0 || bullet.x()!=2.5 || bullet.y()!=2 || bullet.rotation()!=90) throw new IllegalStateException("bullet snapshot");
    switch(ticks++) { case 0: api.moveUp(); break; case 1: api.moveDown(); break; case 2: api.moveLeft(); break; case 3: api.moveRight(); break; case 4: api.rotateLeft(); break; case 5: api.rotateRight(); break; case 6: api.shoot(); break; default: return; }
    api.shoot();`, 'private int ticks;');
  const compatibility = await evaluate(`(async()=>{const runner=await createRunner(${JSON.stringify(contract)},{language:'java'});window.healthy=runner;const actions=[];for(let i=0;i<8;i++)actions.push((await runner.runTick(snapshot))?.action??null);return {actions,timings:runner.timings};})()`);
  assert.deepEqual(compatibility.actions,['moveUp','moveDown','moveLeft','moveRight','rotateLeft','rotateRight','shoot',null]);
  check('Complete immutable snapshot, seven actions, no action and retained fields',compatibility);
  const failures=[
    ['runtime exception',java('api.shoot(); throw new IllegalStateException("expected Java failure");'),'RUNTIME_ERROR'],
    ['immutable snapshot',java('s.allTanks().clear();'),'RUNTIME_ERROR'],
    ['infinite tick',java('while(true) {}'),'EXECUTION_TIMEOUT'],
    ['hanging constructor',java('', 'public MyTank() { while(true) {} }'),'WORKER_TIMEOUT'],
    ['hanging static initializer',java('', 'static { if(hang()) while(true) {} } private static boolean hang() { return true; }'),'WORKER_TIMEOUT'],
    ['guest JavaScript interoperability',`import tankscript.TankScript; import org.teavm.jso.JSBody; public class MyTank {
      @JSBody(params={"action"},script="fetch('${origin}/__java-test-probe__',{method:'POST',mode:'no-cors'});") private static native void attack(int action);
      public void tick(TankScript.Snapshot s,TankScript api){attack(1);api.shoot();} }`,'RUNTIME_ERROR'],
  ];
  for(const [name,code,expected] of failures){
    const result=await evaluate(`(async()=>{let runner;const start=performance.now();try{runner=await createRunner(${JSON.stringify(code)},{language:'java'});await runner.runTick(snapshot);return {unexpectedSuccess:true};}catch(error){return {code:error.code,message:error.message,elapsedMs:performance.now()-start};}finally{await runner?.dispose();}})()`);
    assert.equal(result.code,expected,JSON.stringify(result));
    // An independent runner and the main page remain responsive after each failure.
    assert.equal(await evaluate('healthy.runTick(snapshot).then(command=>command??null)'),null);
    check('Isolated failure: '+name,result);
  }
  assert.equal(requests.filter(request=>request.path==='/__java-test-probe__').length,0);
  await evaluate('healthy.dispose()');
  await until('document.querySelectorAll(\'iframe[title="Experimental Java execution"]\').length===0');
  assert.equal(requests.some(request=>request.path==='/api/tanks' && request.method!=='GET'),false);
  check('Java never saves and all execution frames are cleaned up',{});

  const pendingAssets = await evaluate(`(async()=>{
    const {createJavaWorkerSession}=await import('/frontend/src/game/tank-script/java/javaWorkerSession.js');
    const controller=new AbortController();const session=createJavaWorkerSession(controller.signal);
    const pending=session.request('initializeCompiler',new Promise(()=>{}),1000).catch(error=>error.code);
    controller.abort();const code=await pending;await session.dispose();return code;
  })()`);
  assert.equal(pendingAssets,'DISPOSED');
  check('Cancellation also settles while compiler assets are still pending',{});

  // Reuse the actual Editor/Debugger for the three existing languages, with Java opted in.
  for(const [language,label,code] of [
    ['javascript','JavaScript','shoot();'],
    ['typescript','TypeScript','const health: number = tankHealth; if (health > 0) shoot();'],
    ['python','Python','shoot()'],
  ]) {
    await evaluate('document.querySelector("#tank-language").click()');
    await evaluate(`Array.from(document.querySelectorAll('[role="option"]')).find(node=>node.textContent===${JSON.stringify(label)}).click()`);
    await until(`document.querySelector('#tank-language-selected').textContent===${JSON.stringify(label)}`);
    await setCode(code,language);
    await evaluate('document.querySelector("#tank-debugger-tab").click()');
    assert.match(await generate(),/"action": "shoot"/);
    check('Existing '+label+' still runs in the real Debugger',{});
  }
  await page.close();
  }
  report.status='PASS';
}catch(error){report.status='FAIL';report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{
  report.requests=requests; report.errors=chrome.errors;
  await mkdir(new URL('../../experiments/java-teavm/results/',import.meta.url),{recursive:true});
  const resultName = production ? 'debugger-production' : disabled ? 'debugger-disabled' : 'debugger-integration';
  await writeFile(new URL('../../experiments/java-teavm/results/'+resultName+'.json',import.meta.url),JSON.stringify(report,null,2));
  await chrome.close(); await server.close();
  for(const socket of sockets.clients) socket.terminate();
  await new Promise(resolve=>sockets.close(resolve));
  await new Promise(resolve=>fixture.close(resolve));
}
