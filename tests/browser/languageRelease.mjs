import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { preview } from 'vite';
import { readMongoUri } from '../../backend/mongoConfig.js';
import { startLiveService, stopLiveService } from '../helpers/liveService.cjs';
import { createAccountDetails } from '../helpers/apiFixtures.cjs';
import { startTankWorkflowFixture } from '../helpers/tankWorkflowFixture.mjs';
import { launchChrome } from '../../experiments/java-cheerpj/chrome.mjs';

// Exercise the production UI. By default use real Express and a disposable database.
// --ui-only uses local API fixtures and explicitly skips backend/database checks.
// No guest runtime, CSP or execution deadline is patched by this test.
const databaseName='tankscript_test_'+randomBytes(10).toString('hex');
const safeDatabase=/^tankscript_test_[a-f0-9]{20}$/;
process.env.TANKSCRIPT_DB_NAME=databaseName;
process.env.VITE_EXPERIMENTAL_JAVA='true'; // Production must ignore even an explicit opt-in.
const require=createRequire(new URL('../../backend/package.json',import.meta.url));
const {MongoClient}=require('mongodb');
const output=new URL('../../coverage/language-release/',import.meta.url);
const uiOnly=process.argv.includes('--ui-only');
const report={measuredAt:new Date().toISOString(),mode:uiOnly?'production UI + local API fixtures (no backend/database validation)':'production preview + production Express',checks:[]};
const check=(name,detail)=>{report.checks.push({name,detail});console.log('PASS:',name);};
const languages=[
  {id:'javascript',name:'JavaScript',tank:'Public Script',code:'rotateRight();'},
  {id:'typescript',name:'TypeScript',tank:'Public Typed',code:'const ready: boolean = true; if (ready) rotateRight();'},
  {id:'python',name:'Python',tank:'Public Python',code:'rotate_right()'},
];
let client,server,chrome,page,fixture,databaseReady=false,releasePython;
let pythonHeld=false;
try{
  assert.ok(safeDatabase.test(databaseName));
  let backend;
  if(uiOnly){fixture=await startTankWorkflowFixture();backend=fixture.origin;databaseReady=true;}
  else{
    client=new MongoClient(await readMongoUri(process.env.TANKSCRIPT_DB_CONFIG));await client.connect();databaseReady=true;
    backend=await startLiveService({nodeEnv:'production',experimentalJava:true});
  }
  const storedTank=id=>uiOnly?fixture.tanks.get(id):client.db(databaseName).collection('tanks').findOne({id});
  server=await preview({logLevel:'error',preview:{host:'127.0.0.1',port:0,proxy:{
    '/api':{target:backend},'/ws':{target:backend.replace('http:','ws:'),ws:true},
  }},plugins:[{name:'hold-one-python-download',configurePreviewServer(server){server.middlewares.use((req,_res,next)=>{
    // A held first download makes loading/cancellation observable without extra execution time.
    if(!pythonHeld&&/\/pyodide\.asm-[^/]+\.wasm$/.test(req.url.split('?')[0])){
      pythonHeld=true;releasePython=next;return;
    }
    next();
  });}}]});
  const origin='http://127.0.0.1:'+server.httpServer.address().port;
  chrome=await launchChrome({pauseNewTargets:false});report.browser=chrome.version.Browser;
  page=await chrome.newPage(origin);
  const evaluate=expression=>page.evaluate(expression);
  async function until(expression){
    for(let attempt=0;attempt<1200;attempt++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}
    throw Error('Timed out: '+expression+'; '+await evaluate('document.body.innerText.slice(-1200)'));
  }
  const click=text=>evaluate(`(()=>{const button=Array.from(document.querySelectorAll('button')).find(node=>node.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('Missing button: '+${JSON.stringify(text)});button.click();})()`);
  const input=(selector,value)=>evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  async function select(selector,value){
    await until('!document.querySelector("#saved-tank").disabled');
    await evaluate('document.querySelector("#saved-tank").click()');
    await evaluate('Array.from(document.querySelectorAll("#saved-tank-menu [role=option]")).find(node=>node.value==='+JSON.stringify(value)+').click()');
  }
  const key=(name,code,virtual,modifiers=0)=>chrome.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:name,code,windowsVirtualKeyCode:virtual,modifiers},page.target.sessionId)
    .then(()=>chrome.send('Input.dispatchKeyEvent',{type:'keyUp',key:name,code,windowsVirtualKeyCode:virtual,modifiers},page.target.sessionId));
  async function code(text){
    // Set exact fixtures through the real public API; simulated multiline typing
    // applies Monaco's auto-indentation and changes diagnostic line contents.
    await evaluate(`(()=>{const mode=document.querySelector('[data-mode-id]').getAttribute('data-mode-id');
      const editor=editorApi.getEditors().find(editor=>editor.getDomNode()?.isConnected&&editor.getModel()?.getLanguageId()===mode);
      const model=editor.getModel();model.setValue(${JSON.stringify(text)});
      editor.setPosition({lineNumber:model.getLineCount(),column:model.getLineMaxColumn(model.getLineCount())});editor.focus();})()`);
    await until('document.querySelector(\'input[name="tank-code"]\').value.replaceAll("\\r\\n","\\n") === '+JSON.stringify(text));
  }
  async function language(name){
    await evaluate('document.querySelector("#tank-language").click()');
    await evaluate(`Array.from(document.querySelectorAll('[role="option"]')).find(node=>node.textContent===${JSON.stringify(name)}).click()`);
    await until('document.querySelector("#tank-language-selected").textContent === '+JSON.stringify(name));
    await until('document.querySelector("[data-mode-id]")?.getAttribute("data-mode-id") === '+JSON.stringify(languages.find(entry=>entry.name===name).id));
    // A new tank remounts Monaco; let its mount/change listeners attach before editing.
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  }
  async function generate(){
    await evaluate('document.querySelector(".debugger-generate-button").click()');
    await new Promise(r=>setTimeout(r,50));await until('!document.querySelector(".debugger-generate-button").disabled');
    return evaluate('document.querySelector(".debugger-command-output").textContent');
  }
  const account={...createAccountDetails(),password:'abcdefg'};
  await chrome.send('Page.navigate',{url:origin+'/register'},page.target.sessionId);
  await until('!!document.querySelector("#confirm-password")');
  await input('#username',account.username);await input('#email',account.email);
  await input('#password','abcdef');await input('#confirm-password','abcdef');await click('Create Account');
  await until('document.querySelector(".alert-danger")?.textContent.includes("at least 7 characters")');
  await input('#password',account.password);await input('#confirm-password','different');await click('Create Account');
  await until('document.querySelector(".alert-danger")?.textContent.includes("Passwords do not match")');
  for(const width of [1280,390]){
    await chrome.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width===390},page.target.sessionId);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
  }
  await input('#confirm-password',account.password);await click('Create Account');
  await until('!!document.querySelector("#tank-language")');
  assert.equal(await evaluate('fetch("/api/auth/me").then(response=>response.status)'),200);
  if(!uiOnly){
  const rejectedPassword=await evaluate('fetch("/api/auth/create",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify('+JSON.stringify({...createAccountDetails(),password:'abcdef'})+')}).then(response=>response.status)');
  assert.equal(rejectedPassword,400);
  }
  check('Registration UI rejects six characters/mismatch, accepts seven letters, and fits desktop/mobile');
  const hidden={id:'hidden-java',name:'Dormant Java',code:'class MyTank {}',language:'java',color:'#317d84',ownerUsername:account.username};
  const legacy={id:'legacy-script',name:'Legacy Script',code:'rotateLeft();',color:'#317d84',ownerUsername:account.username};
  if(uiOnly)for(const tank of [hidden,legacy])fixture.tanks.set(tank.id,tank);
  else await client.db(databaseName).collection('tanks').insertMany([hidden,legacy]);
  await chrome.send('Page.navigate',{url:origin+'/tank-editor?language=java&VITE_EXPERIMENTAL_JAVA=true'},page.target.sessionId);
  await until('!!document.querySelector("#tank-language")');
  assert.equal(await evaluate('document.querySelector("#tank-language-selected").textContent'),'Choose a language');
  assert.equal(await evaluate('document.querySelector(".tank-save-button").disabled'),true);
  await mkdir(output,{recursive:true});
  for(const width of [1280,390]){
    await chrome.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width===390},page.target.sessionId);
    await evaluate('document.querySelector("#tank-language").scrollIntoView({block:"center"});document.querySelector("#tank-language").click()');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    await writeFile(new URL('new-tank-'+width+'.png',output),Buffer.from((await page.screenshot()).data,'base64'));
    await evaluate('document.querySelector("#tank-language").click()');
  }
  check('New-tank language choice and logos fit desktop/mobile');
  await evaluate('localStorage.setItem("VITE_EXPERIMENTAL_JAVA","true");localStorage.setItem("tankLanguage","java");localStorage.setItem("experimentalJava","true")');
  await chrome.send('Page.reload',{},page.target.sessionId);await until('!!document.querySelector("#tank-language")');
  await until('!document.querySelector("#saved-tank").disabled');
  await language('JavaScript');await until('!!document.querySelector(".monaco-editor textarea")');
  await evaluate('document.querySelector("#saved-tank").click()');
  const editorApiFile=(await readdir(new URL('../../dist/assets/',import.meta.url))).find(name=>/^editor\.api-.*\.js$/.test(name));
  assert.ok(editorApiFile);
  await evaluate(`import('/assets/${editorApiFile}').then(module=>window.editorApi=Object.values(module).find(value=>value&&typeof value.getModels==='function'&&typeof value.getEditors==='function'))`);
  assert.ok(await evaluate('!!window.editorApi'),'The actual built Monaco API must be available');
  assert.equal(await evaluate('document.querySelector("#tank-language-selected").textContent'),'JavaScript');
  assert.equal(await evaluate('!!document.querySelector(\'#saved-tank-menu [value="hidden-java"]\')'),false);
  await evaluate('document.querySelector("#saved-tank").click()');
  await evaluate('document.querySelector("#tank-language").click()');
  await until('Array.from(document.querySelectorAll(".tank-language-logo")).every(image=>image.complete&&image.naturalWidth>0)');
  const disabled=await evaluate(`(()=>{const node=Array.from(document.querySelectorAll('[role="option"]')).find(node=>node.textContent==='Java — in development');node.click();return node.getAttribute('aria-disabled');})()`);
  assert.equal(disabled,'true');assert.equal(await evaluate('document.querySelector("#tank-language-selected").textContent'),'JavaScript');
  await evaluate('document.querySelector("#tank-language").click()');
  assert.equal(chrome.network.some(item=>/__java-debugger__|javaTankWorker|compiler\.wasm/.test(item.url)),false);
  assert.equal(chrome.network.some(item=>/pyodide\.asm-/.test(item.url)),false);
  check('Production selector/logos, hidden Java, URL/storage bypass attempts and lazy startup');

  for(const entry of languages){
    if(entry.id!=='javascript')await language(entry.name);
    await until('document.querySelector("[data-mode-id]")?.getAttribute("data-mode-id") === '+JSON.stringify(entry.id));
    const starter=await evaluate('document.querySelector(\'input[name="tank-code"]\').value');assert.ok(starter.length>50);
    assert.equal(await evaluate('!!document.querySelector("#tank-python-notice")'),entry.id==='python');
    await code(entry.code);
  }
  for(const entry of languages){
    await language(entry.name);assert.equal(await evaluate('document.querySelector(\'input[name="tank-code"]\').value'),entry.code);
  }
  for(const entry of languages){
    await click('Start New Tank');await language(entry.name);await code(entry.code);
    await input('#tank-name',entry.tank);await click('Save New Tank');
    await until('!document.querySelector(".tank-save-button").disabled&&document.querySelector(".alert-success")?.textContent.includes("was saved")');
    assert.equal(await evaluate('document.querySelector("#tank-language").disabled'),true);
  }
  assert.equal(chrome.network.some(item=>/pyodide\.asm-/.test(item.url)),false);
  const saved=await evaluate('fetch("/api/tanks").then(response=>response.json())');
  for(const entry of languages){
    const tank=saved.find(t=>t.name===entry.tank);assert.equal(tank.language,entry.id);assert.equal(tank.code,entry.code);entry.savedId=tank.id;
    const stored=await storedTank(tank.id);
    assert.deepEqual(Object.keys(stored).sort(),[...(uiOnly?[]:['_id']),'code','color','id','language','name','ownerUsername'].sort());
  }
  check(uiOnly?'Three Monaco modes/starters/drafts, source roundtrip with API fixtures and lazy Python':'Three Monaco modes/starters/drafts, original-source persistence and saving without Python loading');
  await chrome.send('Page.reload',{},page.target.sessionId);await until('!!document.querySelector("#tank-language")');
  await until('!document.querySelector("#saved-tank").disabled');
  await select('#saved-tank',languages[0].savedId);await until('!!document.querySelector(".monaco-editor textarea")');
  await evaluate(`import('/assets/${editorApiFile}').then(module=>window.editorApi=Object.values(module).find(value=>value&&typeof value.getModels==='function'&&typeof value.getEditors==='function'))`);
  for(const entry of languages){
    await select('#saved-tank',entry.savedId);await until('document.querySelector("#tank-language-selected").textContent === '+JSON.stringify(entry.name));
    assert.equal(await evaluate('document.querySelector(\'input[name="tank-code"]\').value'),entry.code);
    assert.equal(await evaluate('document.querySelector("#tank-language").disabled'),true);
    assert.equal(await evaluate('document.querySelector("#saved-tank img").getAttribute("title")'),entry.name);
    await code('sho');await key(' ','Space',32,2);
    await until('document.querySelector(".suggest-widget.visible")?.textContent.includes("shoot")');
    await key('Escape','Escape',27);await code(entry.code);
    entry.code+=entry.id==='python'?'\n# edited':'\n// edited';
    await code(entry.code);
    await click('Update Tank');
    await until('!document.querySelector(".tank-save-button").disabled&&document.querySelector(".alert-success")?.textContent.includes("was updated")');
    assert.equal((await storedTank(entry.savedId)).language,entry.id);
  }
  check('Reopened source, permanent language, matching saved-list logos and genuine API autocomplete for all three languages');
  if(!uiOnly){
  for(const entry of languages){
    const conversion=await evaluate('fetch("/api/tanks/'+entry.savedId+'",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify('+JSON.stringify({tank:{name:entry.tank,code:'replacement',color:'#317d84',language:entry.id==='python'?'javascript':'python'}})+')}).then(r=>r.status)');
    assert.equal(conversion,400);
    assert.equal((await client.db(databaseName).collection('tanks').findOne({id:entry.savedId})).code,entry.code);
  }
  check('Direct API conversions rejected for every public language without overwriting source');
  }

  for(const entry of languages){
    await select('#saved-tank',entry.savedId);await click('Debugger');
    if(entry.id==='python'){
      await evaluate('document.querySelector(".debugger-generate-button").click()');
      for(let attempt=0;attempt<100&&!pythonHeld;attempt++)await new Promise(r=>setTimeout(r,25));assert.ok(pythonHeld);
      assert.match(await evaluate('document.querySelector(".debugger-command-output").textContent'),/Loading|Preparing|Starting/i);
      const isolation=await evaluate(`(()=>{const frame=document.querySelector('iframe[title="Python execution"]');return {sandbox:frame.getAttribute('sandbox'),opaque:frame.contentDocument===null,policy:frame.srcdoc};})()`);
      assert.equal(isolation.sandbox,'allow-scripts');assert.equal(isolation.opaque,true);assert.match(isolation.policy,/wasm-unsafe-eval/);assert.doesNotMatch(isolation.policy,/'unsafe-eval'/);
      await click('API Reference');await until('document.querySelectorAll(\'iframe[title="Python execution"]\').length===0');
      releasePython();releasePython=undefined;await click('Debugger');
      check('Python loading indicator, opaque CSP and cancellation during a held runtime download');
    }
    assert.match(await generate(),/"action": "rotateRight"/);
    await until('document.querySelectorAll(\'iframe[title="Python execution"]\').length===0');
    check('Production Debugger: '+entry.name);
  }
  await select('#saved-tank','legacy-script');assert.equal(await evaluate('document.querySelector("#tank-language-selected").textContent'),'JavaScript');
  assert.match(await generate(),/"action": "rotateLeft"/);check('Legacy records without language still execute as JavaScript');
  await select('#saved-tank',languages[1].savedId);await code('const health: string = tankHealth; shoot();');
  await until('!!document.querySelector(".squiggly-error")');assert.match(await generate(),/Error:.*TypeScript|Error:.*line/i);
  await select('#saved-tank',languages[2].savedId);await code('if True\n    shoot()');assert.match(await generate(),/Error:.*Line 1/i);
  await code('shoot()\nraise ValueError("expected release probe")');assert.match(await generate(),/Line 2: ValueError: expected release probe/);
  await code('while True:\n    pass');assert.match(await generate(),/execution time|time limit/i);
  await until('document.querySelectorAll(\'iframe[title="Python execution"]\').length===0');
  check('TypeScript markers/compile errors and Python syntax/runtime/timeout errors clean up');
  await code('ffi = shoot.__globals__["_builtins"].__import__("pyodide.ffi", fromlist=["to_js"])\ntry:\n    ffi.to_js({}).constructor.constructor("return globalThis")()\nexcept BaseException as error:\n    assert "EvalError" in str(error), str(error)\n    shoot()\nelse:\n    raise AssertionError("Dynamic JavaScript was allowed")');
  assert.match(await generate(),/"action": "shoot"/);check('Python bridge cannot bypass production CSP to evaluate JavaScript');
  await code('rotate_left()');await click('Update Tank');await until('!document.querySelector(".tank-save-button").disabled&&document.querySelector(".alert-success")?.textContent.includes("was updated")');
  assert.equal((await storedTank(languages[2].savedId)).code,'rotate_left()');
  check('Editing and updating Python preserves original source');

  await mkdir(output,{recursive:true});
  for(const width of [1280,390]){
    await chrome.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width===390},page.target.sessionId);
    await click('API Reference');await evaluate('document.querySelector(".tank-code-panel").scrollIntoView({block:"start"})');
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    await evaluate('document.querySelector("#saved-tank").scrollIntoView({block:"center"});document.querySelector("#saved-tank").click()');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.ok(await evaluate('document.querySelector("#saved-tank-menu").getBoundingClientRect().right<=innerWidth'));
    assert.equal(await evaluate('document.querySelector("#tank-language").disabled'),true);
    await writeFile(new URL('python-'+width+'.png',output),Buffer.from((await page.screenshot()).data,'base64'));
    await evaluate('document.querySelector("#saved-tank").click()');
  }
  check('Python notice and selector fit desktop/mobile viewports (desktop emulation)');
  if(!uiOnly){
  const javaRequests=await evaluate(`Promise.all(['POST','PUT'].map(method=>fetch(method==='POST'?'/api/tanks':'/api/tanks/${languages[0].savedId}',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({tank:{name:'Blocked Java',code:'class MyTank {}',language:'java',color:'#317d84'},VITE_EXPERIMENTAL_JAVA:'true',NODE_ENV:'development'})}).then(response=>response.status)))`);
  assert.deepEqual(javaRequests,[400,400]);
  for(const endpoint of ['/api/tanks','/api/tanks/all'])assert.equal(await evaluate(`fetch(${JSON.stringify(endpoint)}).then(r=>r.json()).then(tanks=>tanks.some(t=>t.language==='java'))`),false);
  assert.equal((await client.db(databaseName).collection('tanks').findOne({id:hidden.id})).code,hidden.code);
  check('Production API rejects Java creation/conversion and hides retained experimental records');
  }

  await chrome.send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false},page.target.sessionId);
  await chrome.send('Page.navigate',{url:origin+'/battle'},page.target.sessionId);
  await until('Array.from(document.querySelectorAll("button")).some(b=>b.getAttribute("aria-label")?.startsWith("Add one Public Python"))');
  assert.equal(await evaluate('!!document.querySelector("#java-tank-file")'),false);
  await evaluate(`for(const name of ${JSON.stringify(languages.map(l=>l.tank))})Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')?.startsWith('Add one '+name+' (')).click()`);
  for(const entry of languages){
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".battle-tank-option")).find(row=>row.textContent.includes('+JSON.stringify(entry.tank+' (')+')).querySelector(".tank-language-logo").title'),entry.name);
  }
  for(const width of [1280,390]){
    await chrome.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width===390},page.target.sessionId);
    await evaluate('document.querySelector(".battle-tank-option").scrollIntoView({block:"center"})');
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    await writeFile(new URL('battle-'+width+'.png',output),Buffer.from((await page.screenshot()).data,'base64'));
  }
  check('Selected battle rows and language logos fit desktop/mobile');
  await input('#battle-speed','0');await click('Start Battle');
  await until('Number(document.querySelector(".battle-tick-count")?.textContent.match(/TICK (\\d+)/)?.[1])>=2');
  for(const entry of languages)assert.ok(await evaluate('Array.from(document.querySelectorAll(".battle-participant-list .tank-language-logo")).some(image=>image.title==='+JSON.stringify(entry.name)+')'));
  await click('Pause Battle');const paused=await evaluate('document.querySelector(".battle-tick-count").textContent');
  await new Promise(r=>setTimeout(r,250));assert.equal(await evaluate('document.querySelector(".battle-tick-count").textContent'),paused);
  await click('Resume Battle');await click('Reset Battle');await until('document.querySelectorAll(\'iframe[title="Python execution"]\').length===0');
  await click('Start Battle');await until('document.body.innerText.includes("BATTLE COMPLETE")');
  await until('document.querySelectorAll(\'iframe[title="Python execution"]\').length===0');
  check('Actual three-language battle, pause/resume/reset/completion and Python worker cleanup');
  const files=await readdir(new URL('../../dist/assets/',import.meta.url));
  assert.equal(files.some(name=>/compiler\.wasm|classlib-teavm|javaTankWorker/.test(name)),false);
  const runner=files.find(name=>name.startsWith('tankScriptWorkerRunner-'));assert.ok(runner);
  const rejected=await evaluate(`import('/assets/${runner}').then(async module=>{
    const results=[];for(const run of [()=>module.createTankScriptWorkerRunner('class MyTank {}',{language:'java'}),()=>module.createTankScriptBattleRunner([{tankId:1,source:'class MyTank {}',language:'java'}])])try{await run();results.push('ALLOWED');}catch(error){results.push(error.message);}return results;
  })`);
  assert.ok(rejected.every(message=>/only available in development/.test(message)));
  assert.equal(chrome.network.some(item=>/__java-debugger__|javaTankWorker|compiler\.wasm/.test(item.url)),false);
  assert.equal(chrome.network.some(item=>item.status>=400&&!item.url.includes('/api/')),false);
  check('Production runner gates and assets remain dormant; public runtime files load successfully');
  await chrome.send('Page.navigate',{url:origin+'/tank-editor'},page.target.sessionId);
  await until('!!document.querySelector("#saved-tank")&&!document.querySelector("#saved-tank").disabled');
  await evaluate('document.querySelector("#saved-tank").focus()');await key('ArrowDown','ArrowDown',40);
  await until('document.querySelector("#saved-tank").getAttribute("aria-expanded")==="true"');
  await key('Escape','Escape',27);
  await until('document.querySelector("#saved-tank").getAttribute("aria-expanded")==="false"');
  await evaluate('window.confirm=()=>true');
  for(const entry of languages){
    await select('#saved-tank',entry.savedId);await click('Delete Tank');
    await until('document.querySelector(".alert-success")?.textContent.includes("was deleted")');
    assert.equal(await storedTank(entry.savedId),uiOnly?undefined:null);
    assert.equal(await evaluate('document.querySelector("#tank-language-selected").textContent'),'Choose a language');
  }
  check('Saved picker supports keyboard open/close; deleting each language returns to a new-tank choice');
  if(uiOnly)report.skipped=['Express password validation','Direct API language immutability','MongoDB persistence/legacy records','Production Java API gating'];
  report.status='PASS';
}catch(error){report.status='FAIL';report.failure=databaseReady?error.stack:'Database setup failed; details suppressed.';console.error(report.failure);process.exitCode=1;}
finally{
  releasePython?.();
  if(chrome){report.browserErrors=chrome.errors;await chrome.close();}
  if(server)await server.close();await stopLiveService();await fixture?.close();
  if(client&&databaseReady){assert.ok(safeDatabase.test(databaseName));await client.db(databaseName).dropDatabase();report.temporaryDatabaseRemoved=true;}
  await client?.close();await mkdir(output,{recursive:true});await writeFile(new URL('production.json',output),JSON.stringify(report,null,2));
}
