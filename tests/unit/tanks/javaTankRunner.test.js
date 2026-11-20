import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { createJavaTankRunner, getJavaResourceUsage } from '../../../frontend/src/game/tank-script/java/javaTankRunner.js';
import { createJavaWorkerSession } from '../../../frontend/src/game/tank-script/java/javaWorkerSession.js';
import { TankScriptRunnerError } from '../../../frontend/src/game/tank-script/shared/tankScriptRunnerProtocol.js';

jest.mock('../../../frontend/src/game/tank-script/shared/tankScriptFeatures.js',()=>({JAVA_DEBUGGER_ENABLED:true,MAX_JAVA_BATTLE_TANKS:4}));
jest.mock('../../../frontend/src/game/tank-script/java/javaWorkerSession.js',()=>({createJavaWorkerSession:jest.fn()}));
jest.mock('../../../frontend/src/game/tank-script/java/javaRuntimeAssets.js',()=>({loadJavaRuntimeAssets:jest.fn().mockResolvedValue({})}));
const state={tankId:0,tankPosition:{x:1,y:2},tankRotation:90,tankHealth:3,arenaWidth:8,arenaHeight:8,
  allTanks:[{id:0,name:'Own "\n🐍',x:1,y:2,rotation:90,health:3}],
  allBullets:[{id:1,ownerId:0,x:2.5,y:3,rotation:180}]};
let sessions;
let action;
let failure;
let sequence=0;
let clock=0;
let artifactBytes=8;
let artifact;
const source=()=>`class MyTank {} // unit ${++sequence}`;
beforeEach(()=>{
  clock+=60_000;
  jest.spyOn(performance,'now').mockImplementation(()=>clock);
  artifactBytes=8;
  artifact=undefined;
  sessions=[];action='shoot';failure=undefined;
  createJavaWorkerSession.mockReset().mockImplementation(()=>{
    const session={dispose:jest.fn().mockResolvedValue(undefined),close:jest.fn().mockResolvedValue(undefined)};
    session.request=jest.fn(async(type,fields)=>{
      await fields;
      if(failure?.type===type) {
        if(failure.throw)throw failure.throw;
        return {error:failure.error};
      }
      if(type==='compile')return {wasm:artifact??new Uint8Array(artifactBytes),compilationMs:12};
      if(type==='runTick')return {action};
      return {};
    });
    sessions.push(session);return session;
  });
});
afterEach(()=>{
  expect(getJavaResourceUsage().activeRunners).toBe(0);
  expect(getJavaResourceUsage().activeCompilers).toBe(0);
  jest.restoreAllMocks();
});

test('adapter compiles once per revision and validates complete snapshots and returned commands',async()=>{
  const code=source();
  const first=await createJavaTankRunner(code);
  expect(first.timings.compilationCached).toBe(false);
  expect(first.timings.compilationMs).toBe(12);
  expect(await first.runTick(state)).toEqual({action:'shoot'});
  action=null;
  expect(await first.runTick(state)).toBeUndefined();
  const tick=sessions[1].request.mock.calls.find(([type])=>type==='runTick');
  expect(JSON.parse(tick[1].snapshotJSON)).toEqual(state);
  expect(tick[2]).toBe(500);
  const initialization=sessions[1].request.mock.calls.find(([type])=>type==='initializeRuntime');
  expect((await initialization[1]).executionMs).toBe(100);
  await first.dispose();
  const second=await createJavaTankRunner(code);
  expect(second.timings.compilationCached).toBe(true);
  expect(second.timings.compilationMs).toBe(0);
  expect(second.timings.compilerInitializationMs).toBe(0);
  expect(sessions.flatMap(session=>session.request.mock.calls).filter(([type])=>type==='compile')).toHaveLength(1);
  expect(sessions[0].dispose).toHaveBeenCalled();
  await second.dispose();
});

test('compile diagnostics keep source locations and always release the compiler',async()=>{
  failure={type:'compile',error:{code:'COMPILE_ERROR',diagnostics:[{file:'MyTank.java',line:4,column:7,message:'missing symbol'}]}};
  await expect(createJavaTankRunner(source())).rejects.toThrow('MyTank.java, line 4, column 7: missing symbol');
  expect(sessions[0].dispose).toHaveBeenCalled();
  expect(sessions).toHaveLength(1);
});

test('tick timeout disables and terminates the runner, while a new preview can recover',async()=>{
  const code=source(),runner=await createJavaTankRunner(code);
  failure={type:'runTick',throw:new TankScriptRunnerError('WORKER_TIMEOUT')};
  await expect(runner.runTick(state)).rejects.toMatchObject({code:'EXECUTION_TIMEOUT'});
  expect(sessions[1].close).toHaveBeenCalledTimes(1);
  await expect(runner.runTick(state)).rejects.toMatchObject({code:'EXECUTION_TIMEOUT'});
  await runner.dispose();failure=undefined;
  const recovered=await createJavaTankRunner(code);
  expect(await recovered.runTick(state)).toEqual({action:'shoot'});
  await recovered.dispose();
});

test('invalid commands and invalid snapshots never become game commands',async()=>{
  const runner=await createJavaTankRunner(source());
  await expect(runner.runTick({...state,allBullets:null})).rejects.toMatchObject({code:'INVALID_SNAPSHOT'});
  action='fetch';
  await expect(runner.runTick(state)).rejects.toMatchObject({code:'INVALID_COMMAND'});
  expect(sessions[1].close).toHaveBeenCalled();
  await runner.dispose();
});

test('a broken Java worker becomes a contained execution error and stays disabled',async()=>{
  const runner=await createJavaTankRunner(source());
  failure={type:'runTick',throw:new TankScriptRunnerError('WORKER_ERROR')};
  await expect(runner.runTick(state)).rejects.toMatchObject({name:'TankScriptExecutionError',code:'RUNTIME_ERROR'});
  await expect(runner.runTick(state)).rejects.toMatchObject({code:'RUNTIME_ERROR'});
  expect(sessions[1].close).toHaveBeenCalledTimes(1);
  await runner.dispose();
});

test('a worker-reported execution budget failure discards the command and closes the worker',async()=>{
  const runner=await createJavaTankRunner(source());
  failure={type:'runTick',error:{code:'EXECUTION_TIMEOUT',message:'Java exceeded its execution time limit.'}};
  await expect(runner.runTick(state)).rejects.toMatchObject({code:'EXECUTION_TIMEOUT'});
  expect(sessions[1].close).toHaveBeenCalledTimes(1);
  await runner.dispose();
});

test('pre-aborted signals and oversized sources start no workers',async()=>{
  const controller=new AbortController();controller.abort();
  await expect(createJavaTankRunner(source(),{signal:controller.signal})).rejects.toMatchObject({code:'DISPOSED'});
  await expect(createJavaTankRunner('x'.repeat(100001))).rejects.toMatchObject({code:'INVALID_SOURCE'});
  expect(sessions).toHaveLength(0);
});

test('bounded compilation caching evicts old revisions',async()=>{
  const codes=Array.from({length:4},source);
  for(const code of [...codes,codes[0]])await(await createJavaTankRunner(code)).dispose();
  expect(sessions.flatMap(session=>session.request.mock.calls).filter(([type])=>type==='compile')).toHaveLength(5);
});

test('all callers share four runner slots, released after failures, abort and repeated disposal',async()=>{
  const code=source(),controller=new AbortController();
  const runners=[];
  for(let index=0;index<4;index++)runners.push(await createJavaTankRunner(code,{signal:index===0?controller.signal:undefined}));
  const count=sessions.length;
  await expect(createJavaTankRunner(source())).rejects.toThrow('four Java tanks');
  expect(sessions).toHaveLength(count);
  controller.abort();await Promise.resolve();await Promise.resolve();
  expect(getJavaResourceUsage().activeRunners).toBe(3);
  const replacement=await createJavaTankRunner(code);
  await replacement.dispose();await replacement.dispose();
  await Promise.all(runners.map(runner=>runner.dispose()));
});

test('rejects parallel compilers before allocating another worker and recovers after completion',async()=>{
  let finish;
  const firstSession=createJavaWorkerSession.getMockImplementation();
  createJavaWorkerSession.mockImplementationOnce((...args)=>{
    const session=firstSession(...args);
    const request=session.request;
    session.request=jest.fn((type,...fields)=>type==='compile'?new Promise(resolve=>{finish=()=>resolve({wasm:new Uint8Array(8),compilationMs:12});}):request(type,...fields));
    return session;
  });
  const pending=createJavaTankRunner(source());
  while(!finish)await Promise.resolve();
  await expect(createJavaTankRunner(source())).rejects.toThrow('compiler is busy');
  expect(sessions).toHaveLength(1);
  finish();await(await pending).dispose();
  await(await createJavaTankRunner(source())).dispose();
});

test('bounds compilation frequency, leaves cache hits available and recovers after a minute',async()=>{
  const code=source();
  await(await createJavaTankRunner(code)).dispose();
  failure={type:'compile',error:{code:'COMPILE_ERROR',message:'bad syntax'}};
  for(let index=0;index<7;index++)await expect(createJavaTankRunner(source())).rejects.toThrow('bad syntax');
  const count=sessions.length;
  await expect(createJavaTankRunner(source())).rejects.toThrow('eight new compilations');
  expect(sessions).toHaveLength(count);
  failure=undefined;
  const cached=await createJavaTankRunner(code);
  expect(cached.timings.compilationCached).toBe(true);
  await cached.dispose();
  clock+=60_000;
  await(await createJavaTankRunner(source())).dispose();
});

test('cache is bounded by total bytes as well as program count',async()=>{
  artifactBytes=5*1024*1024;
  for(let index=0;index<3;index++)await(await createJavaTankRunner(source())).dispose();
  expect(getJavaResourceUsage()).toMatchObject({cachedPrograms:1,cachedBytes:artifactBytes});
});

test('a small view cannot retain an oversized compiler buffer in the cache',async()=>{
  artifact=new Uint8Array(new ArrayBuffer(8*1024*1024+1),0,8);
  await expect(createJavaTankRunner(source())).rejects.toThrow('oversized module');
  expect(sessions[0].dispose).toHaveBeenCalled();
});

test('aggregate cache accounting includes the backing memory of small views',async()=>{
  artifact=new Uint8Array(new ArrayBuffer(5*1024*1024),0,8);
  for(let index=0;index<3;index++)await(await createJavaTankRunner(source())).dispose();
  expect(getJavaResourceUsage()).toMatchObject({cachedPrograms:1,cachedBytes:5*1024*1024});
});

