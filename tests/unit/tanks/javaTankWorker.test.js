import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, test } from '@jest/globals';
import { createTankScriptApi } from '../../../frontend/src/game/tank-script/shared/tankScriptApi.js';
import { TANK_SCRIPT_ACTIONS } from '../../../frontend/src/game/tank-script/shared/tankScriptRunnerProtocol.js';

// Exercise the trusted protocol with a deterministic fake clock/runtime.
// Genuine Java/Wasm, CSP and real watchdogs are covered by the browser tests.
const body=readFileSync('frontend/src/game/tank-script/java/javaTankWorker.js','utf8');
function worker(tick,construct='',prepare='') {
  const replies=[];
  const context=vm.createContext({self:{},performance:{now:()=>context.clock,timeOrigin:1000},clock:0});
  vm.runInContext(`const createTankScriptApi=${createTankScriptApi.toString()};const actions=${JSON.stringify(TANK_SCRIPT_ACTIONS)};${body}`,context);
  const port={postMessage:value=>replies.push(value)};
  context.self.onmessage({data:'connect-java-worker',ports:[port]});
  vm.runInContext(`executionLimitMs=100;runtime={exports:{construct(){${construct}},beginSnapshot(){${prepare}},addTank(){},addBullet(){},tick(){${tick}}}}`,context);
  return {async request(type){
    await port.onmessage({data:{id:1,type,measureTimings:true,snapshotJSON:JSON.stringify({tankPosition:{},allTanks:[],allBullets:[]})}});
    return replies.at(-1).result;
  }};
}

test('private worker channel keeps the first action and reports worker timing',async()=>{
  const result=await worker('clock=5;api.shoot();api.moveRight();').request('runTick');
  expect(result.action).toBe('shoot');expect(result.timing.executionMs).toBe(5);
  expect(result.timing.snapshotMs).toBe(0);
});

test('a finite Java call that finishes after the budget cannot submit its earlier action',async()=>{
  const result=await worker('api.shoot();clock=101;').request('runTick');
  expect(result.error.code).toBe('EXECUTION_TIMEOUT');expect(result.action).toBeUndefined();
});

test('a long finite constructor receives the same worker budget',async()=>{
  const result=await worker('', 'clock=101;').request('construct');
  expect(result.error.code).toBe('EXECUTION_TIMEOUT');
});

test('snapshot preparation is measured separately without charging it to a short Java tick',async()=>{
  const result=await worker('clock=155;api.shoot();','','clock=150;').request('runTick');
  expect(result.action).toBe('shoot');expect(result.timing.snapshotMs).toBe(150);
  expect(result.timing.executionMs).toBe(5);
});

test('late exceptions cannot bypass the budget and ordinary exceptions discard actions',async()=>{
  expect((await worker('api.shoot();clock=101;throw Error("late");').request('runTick')).error.code).toBe('EXECUTION_TIMEOUT');
  const result=await worker('api.shoot();throw Error("ordinary");').request('runTick');
  expect(result.error.code).toBe('RUNTIME_ERROR');expect(result.action).toBeUndefined();
});
