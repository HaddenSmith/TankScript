import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { readMongoUri } from '../../backend/mongoConfig.js';
import { startLiveService, stopLiveService } from '../helpers/liveService.cjs';
import { createAccountDetails } from '../helpers/apiFixtures.cjs';
import { launchJavaTestBrowser } from '../helpers/javaTestBrowser.mjs';

// Real backend + MongoDB, restricted to a new disposable test database.
const databaseName='tankscript_test_'+randomBytes(10).toString('hex');
const safeDatabase=/^tankscript_test_[a-f0-9]{20}$/;
if(!safeDatabase.test(databaseName))throw Error('Unsafe test database');
process.env.TANKSCRIPT_DB_NAME=databaseName;
process.env.VITE_EXPERIMENTAL_JAVA='true';
const require=createRequire(new URL('../../backend/package.json',import.meta.url));
const {MongoClient}=require('mongodb');
let client, server, chrome;
let databaseReady=false;
const report={measuredAt:new Date().toISOString(),checks:[]};
const results=new URL('../../experiments/java-teavm/results/',import.meta.url);
const secure=process.argv.includes('--https');
const security=process.argv.includes('--security');
let origin;
let probeRequests=0;
const securityPlugin={name:'java-native-policy-probes',enforce:'pre',
  configureServer(server){server.middlewares.use('/__java-public-probe__',(_req,res)=>{probeRequests++;res.end('dummy only');});},
  async load(id){
    if(!security || !id.endsWith('/javaTankWorker.js?raw'))return;
    let code=await readFile(new URL('../../frontend/src/game/tank-script/java/javaTankWorker.js',import.meta.url),'utf8');
    // Executed by the real worker, not privileged debugger evaluation. CSP remains intact.
    const probe=`async function nativePolicyProbe(){
      const result={origin:self.origin,document:typeof document,localStorage:typeof localStorage};
      try{eval('1+1');result.eval='ALLOWED';}catch(error){result.eval=error.name;}
      try{new Function('return 2')();result.Function='ALLOWED';}catch(error){result.Function=error.name;}
      try{await fetch(${JSON.stringify(origin+'/__java-public-probe__')},{credentials:'include'});result.fetch='ALLOWED';}catch(error){result.fetch=error.name;}
      try{result.indexedDB=await new Promise(resolve=>{const request=indexedDB.open('java-public-dummy');request.onsuccess=()=>{request.result.close();resolve('ALLOWED');};request.onerror=()=>resolve(request.error.name);});}catch(error){result.indexedDB=error.name;}
      try{await navigator.storage.getDirectory();result.opfs='ALLOWED';}catch(error){result.opfs=error.name;}
      return result;
    }\n`;
    code=probe+code.replace('send({ id: data.id, result });',"if(data.type==='initializeCompiler'||data.type==='initializeRuntime')result.nativePolicyProbe={role:data.type,...await nativePolicyProbe()}; send({ id: data.id, result });");
    return 'export default '+JSON.stringify(code);
  },
  transform(code,id){
    if(security && id.endsWith('/javaWorkerSession.js'))return code.replace('finishRequest().resolve(data.result);',
      'if(data.result.nativePolicyProbe)(globalThis.javaPolicyProbes??=[]).push(data.result.nativePolicyProbe); finishRequest().resolve(data.result);');
  },
};
const check=(name,detail)=>{report.checks.push({name,passed:true,detail});console.log('PASS:',name);};
try{
  client=new MongoClient(await readMongoUri(process.env.TANKSCRIPT_DB_CONFIG));
  await client.connect();
  databaseReady=true;
  const backend=await startLiveService({nodeEnv:'development',experimentalJava:true});
  const https=secure?{key:await readFile(new URL('../../experiments/java-teavm/generated/browser-tools/local-cert/key.pem',import.meta.url)),
    cert:await readFile(new URL('../../experiments/java-teavm/generated/browser-tools/local-cert/cert.pem',import.meta.url))}:undefined;
  server=await createServer({plugins:[securityPlugin],logLevel:'error',server:{host:'127.0.0.1',port:0,https,proxy:{'/api':{target:backend},'/ws':{target:backend.replace('http:','ws:'),ws:true}}}});
  await server.listen();
  origin=(secure?'https':'http')+'://127.0.0.1:'+server.httpServer.address().port;
  report.transport=secure?'HTTPS with a local self-signed test certificate':'HTTP loopback';
  chrome=await launchJavaTestBrowser();report.browser=chrome.version.Browser;
  report.device='Windows desktop; 390px mobile viewport emulation, not a physical mobile device';
  const page=await chrome.newPage(origin);
  const evaluate=expression=>page.evaluate(expression);
  async function until(expression){
    for(let attempt=0;attempt<1500;attempt++){
      if(await evaluate(expression))return;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw Error('Timed out: '+expression+'; '+await evaluate('document.body.innerText.slice(-1000)'));
  }
  const click=text=>evaluate(`Array.from(document.querySelectorAll('button')).find(node=>node.textContent.trim()===${JSON.stringify(text)}).click()`);
  const input=(selector,value)=>evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const select=(selector,value)=>evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const register=await evaluate(`fetch('/api/auth/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(createAccountDetails())})}).then(async response=>({status:response.status,body:await response.json()}))`);
  assert.equal(register.status,201);
  assert.equal(await evaluate(`fetch('/api/auth/me').then(response=>response.status)`),200);
  await chrome.send('Page.navigate',{url:origin+'/tank-editor'},page.target.sessionId);
  await until('!!document.querySelector(".monaco-editor textarea")');
  const monacoURL=chrome.network.find(item=>/\/monaco-editor\.js\?/.test(item.url))?.url;
  assert.ok(monacoURL);
  const monaco=expression=>evaluate(`import(${JSON.stringify(monacoURL)}).then(monaco=>{${expression}})`);
  async function language(name){
    await evaluate('document.querySelector("#tank-language").click()');
    await evaluate(`Array.from(document.querySelectorAll('[role="option"]')).find(node=>node.textContent.startsWith(${JSON.stringify(name+' —')} )||node.textContent===${JSON.stringify(name)}).click()`);
  }
  async function setCode(code,language='java'){
    await monaco(`monaco.editor.getModels().find(model=>model.getLanguageId()===${JSON.stringify(language)}).setValue(${JSON.stringify(code)});`);
    await until('document.querySelector(\'input[name="tank-code"]\')?.value === '+JSON.stringify(code));
  }
  async function generate(){
    await evaluate('document.querySelector(".debugger-generate-button").click()');
    await new Promise(resolve=>setTimeout(resolve,50));
    await until('!document.querySelector(".debugger-generate-button").disabled');
    return evaluate('document.querySelector(".debugger-command-output").textContent');
  }
  await language('Java');
  await until('document.querySelector(\'input[name="tank-code"]\')?.value.includes("public class MyTank")');
  const starter=await evaluate('document.querySelector(\'input[name="tank-code"]\').value');
  for(const [name,mode] of [['JavaScript','javascript'],['TypeScript','typescript'],['Python','python']]){
    await language(name);await setCode('// separate '+mode,mode);
  }
  await language('Java');
  assert.equal(await evaluate('document.querySelector(\'input[name="tank-code"]\').value'),starter);
  for(const [name,mode] of [['JavaScript','javascript'],['TypeScript','typescript'],['Python','python']]){
    await language(name);
    assert.equal(await evaluate('document.querySelector(\'input[name="tank-code"]\').value'),'// separate '+mode);
  }
  await language('Java');
  check('Four separate language drafts and real Java Monaco mode');
  const source='import tankscript.TankScript; public class MyTank { private int ticks; public void tick(TankScript.Snapshot state, TankScript api) { ticks++; if(ticks%2==1)api.shoot();else api.moveRight(); } }';
  await setCode(source);
  await input('#tank-name','Saved Java Browser');
  await click('Save New Tank');
  await until('!document.querySelector(".tank-save-button").disabled && document.querySelector(".alert-success")?.textContent.includes("was saved")');
  const saved=await evaluate('fetch("/api/tanks").then(response=>response.json())');
  assert.equal(saved.length,1);assert.equal(saved[0].language,'java');assert.equal(saved[0].code,source);
  assert.equal(saved[0].compiledWasm,undefined);
  const id=saved[0].id;
  const stored=await client.db(databaseName).collection('tanks').findOne({id});
  assert.equal(stored.code,source);assert.equal(stored.language,'java');
  assert.deepEqual(Object.keys(stored).sort(),['_id','code','color','id','language','name','ownerUsername'].sort());
  const previousDocument=await evaluate('performance.timeOrigin');
  await chrome.send('Page.reload',{},page.target.sessionId);
  await until('performance.timeOrigin > '+previousDocument+' && !!document.querySelector(".monaco-editor textarea")');
  await until('Array.from(document.querySelector("#saved-tank")?.options ?? []).some(option=>option.value==='+JSON.stringify(id)+')');
  await select('#saved-tank',id);
  await until('document.querySelector(\'input[name="tank-code"]\')?.value === '+JSON.stringify(source));
  assert.match(await evaluate('document.querySelector("#tank-language-selected").textContent'),/Java.*experimental/);
  check('Real authenticated Java create, MongoDB persistence and reopen');
  await click('Debugger');
  assert.match(await generate(),/"action": "shoot"/);
  assert.match(await generate(),/"action": "moveRight"/);
  check('Reopened Java compiles in actual Debugger and retains fields');
  if(security){
    const probes=await evaluate('globalThis.javaPolicyProbes');
    assert.ok(probes.length>=2,'Both compiler and runtime must execute native probes');
    assert.ok(probes.some(probe=>probe.role==='initializeCompiler'));assert.ok(probes.some(probe=>probe.role==='initializeRuntime'));
    for(const probe of probes){
      assert.equal(probe.origin,'null');assert.equal(probe.document,'undefined');assert.equal(probe.localStorage,'undefined');
      assert.equal(probe.eval,'EvalError');assert.equal(probe.Function,'EvalError');
      for(const name of ['fetch','indexedDB','opfs'])assert.notEqual(probe[name],'ALLOWED');
    }
    assert.equal(probeRequests,0);
    const policy=await evaluate('document.querySelector(\'iframe[title="Experimental Java execution"]\').srcdoc');
    assert.match(policy,/wasm-unsafe-eval/);assert.doesNotMatch(policy,/'unsafe-eval'/);assert.match(policy,/connect-src 'none'/);
    check('Compiler and runtime native CSP, networking, cookie and storage isolation',probes);
  }
  await setCode(source.replace('api.moveRight()','api.moveLeft()'));
  await click('Update Tank');
  await until('!document.querySelector(".tank-save-button").disabled && document.querySelector(".alert-success")?.textContent.includes("was updated")');
  await setCode('public class MyTank { broken syntax; }');
  assert.match(await generate(),/line 1/);
  const markers=await monaco(`return monaco.editor.getModelMarkers({owner:'tankscript-java'}).map(({startLineNumber,message})=>({startLineNumber,message}));`);
  assert.ok(markers.some(marker=>marker.startLineNumber===1));
  await click('Update Tank');
  await until('!document.querySelector(".tank-save-button").disabled && document.querySelector(".alert-success")?.textContent.includes("was updated")');
  assert.equal((await evaluate('fetch("/api/tanks").then(response=>response.json())'))[0].code,'public class MyTank { broken syntax; }');
  check('Compiler source markers and saving incomplete drafts without losing source',markers);
  await setCode(source);
  assert.equal((await monaco(`return monaco.editor.getModelMarkers({owner:'tankscript-java'});`)).length,0);
  await click('Update Tank');await until('!document.querySelector(".tank-save-button").disabled && document.querySelector(".alert-success")?.textContent.includes("was updated")');
  await setCode(source+'\n// completion\napi.');
  const labels=await monaco(`const editor=monaco.editor.getEditors().find(editor=>editor.getModel()?.getLanguageId()==='java');const model=editor.getModel();editor.setPosition({lineNumber:model.getLineCount(),column:5});editor.focus();editor.trigger('test','editor.action.triggerSuggest',{});return true;`);
  assert.equal(labels,true);
  await until('document.querySelector(".suggest-widget.visible")?.textContent.includes("shoot()")');
  check('Real Java API autocomplete offers actions in Monaco');
  await evaluate('document.querySelector(".monaco-editor textarea").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",keyCode:27,bubbles:true}))');
  await setCode(source);
  await mkdir(results,{recursive:true});
  for(const [width,mobile] of [[1280,false],[390,true]]){
    await chrome.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile},page.target.sessionId);
    await click('API Reference');
    await evaluate('window.scrollTo(0,0)');
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false);
    await evaluate('document.querySelector("#tank-language").click()');
    assert.equal(await evaluate('document.querySelector(\'[role="listbox"]\')?.getBoundingClientRect().right <= innerWidth'),true);
    await evaluate('document.querySelector("#tank-language").click()');
    await writeFile(new URL('editor-'+width+'.png',results),Buffer.from((await page.screenshot()).data,'base64'));
    await evaluate('document.querySelector(".tank-code-panel").scrollIntoView({block:"start"})');
    await evaluate('document.querySelector("#tank-language").click()');
    await new Promise(resolve=>setTimeout(resolve,150));
    await writeFile(new URL('editor-code-'+width+'.png',results),Buffer.from((await page.screenshot()).data,'base64'));
    await evaluate('document.querySelector("#tank-language").click()');
  }
  check('Desktop 1280px and mobile 390px layouts fit without page overflow');
  await chrome.send('Page.navigate',{url:origin+'/battle'},page.target.sessionId);
  await until('Array.from(document.querySelectorAll("button")).some(button=>button.getAttribute("aria-label")?.startsWith("Add one Saved Java Browser"))');
  const add='Array.from(document.querySelectorAll("button")).find(button=>button.getAttribute("aria-label")?.startsWith("Add one Saved Java Browser"))';
  for(let index=0;index<4;index++)await evaluate(add+'.click()');
  assert.equal(await evaluate(add+'.disabled'),true);
  assert.match(await evaluate('document.body.innerText'),/Java: 4 \/ 4/);
  await click('Start Battle');await until('document.querySelector(".battle-tick-count")?.textContent.includes("TICK 2")');
  await click('Reset Battle');await until('document.querySelectorAll(\'iframe[title="Experimental Java execution"]\').length===0');
  check('Saved community Java enters real four-Java battle; fifth blocked; reset cleans workers');
  await chrome.send('Page.navigate',{url:origin+'/tank-editor'},page.target.sessionId);
  await until('Array.from(document.querySelector("#saved-tank")?.options ?? []).some(option=>option.value==='+JSON.stringify(id)+')');
  await select('#saved-tank',id);
  await evaluate('window.confirm=()=>true');await click('Delete Tank');
  await until('document.querySelector(".alert-success")?.textContent.includes("was deleted")');
  assert.deepEqual(await evaluate('fetch("/api/tanks").then(response=>response.json())'),[]);
  check('Real owned Java deletion and empty saved-tank list');
  report.status='PASS';
}catch(error){report.status='FAIL';report.failure=databaseReady?error.stack:'Database setup failed; connection details suppressed.';console.error(report.failure);process.exitCode=1;}
finally{
  if(chrome){report.errors=chrome.errors;await chrome.close();}
  if(server)await server.close();
  await stopLiveService();
  if(client && databaseReady){
    if(!safeDatabase.test(databaseName))throw Error('Unsafe cleanup database');
    await client.db(databaseName).dropDatabase();
    report.temporaryDatabaseRemoved=true;
  }
  await client?.close();
  const engine=process.argv.find(arg=>arg.startsWith('--browser='))?.split('=')[1]??'chrome';
  const filename=security?'editor-security-'+engine+'.json':engine==='chrome'?'editor-integration.json':'editor-'+engine+'.json';
  await mkdir(results,{recursive:true});await writeFile(new URL(filename,results),JSON.stringify(report,null,2));
}
