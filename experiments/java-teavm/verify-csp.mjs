import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { startExperiment } from './server.mjs';
import { launchChrome } from '../java-cheerpj/chrome.mjs';

const report = { measuredAt: new Date().toISOString(), checks: [] };
const check = (name, detail) => { report.checks.push({ name, passed:true, detail }); console.log('PASS:',name); };
const server = await startExperiment();
const chrome = await launchChrome();
try {
  report.browser = chrome.version.Browser;
  report.runtime = JSON.parse(await readFile(new URL('./generated/csp-runtime-manifest.json',import.meta.url),'utf8'));
  const header = (await fetch(server.executionOrigin+'/frame.html?eval=1&wasm=1')).headers.get('content-security-policy');
  assert.ok(header.includes("'wasm-unsafe-eval'"));
  assert.ok(!header.includes("'unsafe-eval'") && !header.includes("'unsafe-inline'"));
  assert.ok(header.includes("connect-src 'none'"));
  check('Execution CSP has no JavaScript evaluation permission, even with legacy eval query', header);
  const page = await chrome.newPage(server.appOrigin);
  const evaluate = expression => page.evaluate(expression,180_000);
  for(let attempt=0;attempt<100;attempt++) {
    if(await evaluate('!!window.teavmExperiment'))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  await evaluate('teavmExperiment.seeded');
  const positive = await evaluate('fetch("/private/account").then(response=>response.json())');
  assert.equal(positive.canary,'dummy-authenticated-account');
  const controlHits = server.hits.length;
  const negative = await evaluate(`(async()=>{
    const results={};
    for(const [name,options] of [['stock',{loader:'stock'}],['noWasm',{allowWasm:false}]]) {
      const session=await teavmExperiment.createSession(options);
      try{await session.ready;results[name]={unexpectedSuccess:true};}
      catch(error){results[name]={message:error.message};}
      finally{await session.dispose();}
    }
    return results;
  })()`);
  assert.match(negative.stock.message,/unsafe-eval|code generation/i);
  assert.match(negative.noWasm.message,/WebAssembly|Wasm|wasm-unsafe-eval/);
  check('Stock loader fails because JavaScript string evaluation is denied',negative.stock);
  check('Removing wasm-unsafe-eval blocks the patched compiler too',negative.noWasm);

  const ready = await evaluate('(async()=>{window.compiler=await teavmExperiment.createSession();return compiler.ready;})()');
  assert.equal(ready.loader,'csp');
  assert.equal(ready.isolation.origin,'null');
  check('Compiler starts under restrictive CSP in an opaque origin',ready);
  const compiled = await evaluate(`(async()=>{
    const reply=await compiler.compile(teavmExperiment.tanks.starter);
    window.wasm=reply.result?.wasm;
    return {...reply,result:{...reply.result,wasm:undefined}};
  })()`);
  assert.ok(compiled.ok && compiled.result.successful && compiled.result.compilations===1);
  check('Real browser javac and TeaVM compile the original starter',compiled);
  const actor = await evaluate(`(async()=>{
    window.actor=await teavmExperiment.createSession({role:'runtime'});
    const ready=await actor.ready,loaded=await actor.load(wasm),constructed=await actor.construct(2000);
    const first=await actor.runTick(teavmExperiment.snapshot,2000),second=await actor.runTick(teavmExperiment.snapshot,2000);
    return {ready,loaded,constructed,first,second};
  })()`);
  assert.equal(actor.ready.isolation.origin,'null');
  assert.ok(actor.loaded.ok && actor.constructed.ok);
  assert.equal(actor.first.result,'shoot'); assert.equal(actor.second.result,'moveRight');
  check('Isolated runtime retains the Java object across ticks',actor);
  for (const role of ['compiler','actor']) {
    const policy=await evaluate(`${role}.request('policy')`);
    assert.equal(policy.result.wasm.allowed,true);
    assert.ok(Object.values(policy.result.stringCode).every(item=>item.allowed===false&&item.error==='EvalError'));
    check(role+' permits Wasm but blocks eval and function constructors',policy.result);
    const capabilities=await evaluate(`${role}.request('probe',{appOrigin:${JSON.stringify(server.appOrigin)}})`);
    assert.equal(capabilities.result.indexedDBError,'SecurityError');
    assert.ok(capabilities.result.privateFetch.error && capabilities.result.blindPost.error);
    assert.equal(capabilities.result.websocket,'error'); assert.notEqual(capabilities.result.opfs,'opened');
    check(role+' cannot use app credentials, storage or local networking',capabilities.result);
  }
  const memory=await evaluate("actor.request('memory-limit')");
  assert.equal(memory.result.error,'RangeError'); assert.equal(memory.result.before,memory.result.after);
  check('Runtime linear memory cannot grow beyond 64 MiB',memory.result);
  const broken=await evaluate('compiler.compile(teavmExperiment.tanks.broken)');
  assert.equal(broken.result.successful,false);
  assert.ok(broken.result.diagnostics.some(item=>item.severity==='error'&&item.lineNumber>0&&item.columnNumber>0));
  check('Compiler errors retain source locations under restrictive CSP',broken);
  await evaluate('Promise.all([compiler,actor].map(session=>session.dispose()))');
  assert.equal((await chrome.memory()).length,0);
  assert.equal(server.hits.length,controlHits);
  check('No guest endpoint requests or surviving workers', {guestRequests:0,workers:0});
  report.status='PASS';
}catch(error){report.status='FAIL';report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{
  report.errors=chrome.errors;
  await mkdir(new URL('./results/',import.meta.url),{recursive:true});
  await writeFile(new URL('./results/csp-policy.json',import.meta.url),JSON.stringify(report,null,2));
  await chrome.close(); await server.close();
}
