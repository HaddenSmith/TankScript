/** @jest-environment jsdom */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { createJavaWorkerSession } from '../../../frontend/src/game/tank-script/java/javaWorkerSession.js';

let channels;
const originalChannel=globalThis.MessageChannel;
beforeEach(()=>{
  jest.useFakeTimers();channels=[];
  globalThis.MessageChannel=class {
    constructor(){
      this.port1={postMessage:jest.fn(),close:jest.fn()};
      this.port2={close:jest.fn()};channels.push(this);
    }
  };
});
afterEach(()=>{
  document.body.replaceChildren();globalThis.MessageChannel=originalChannel;jest.useRealTimers();
});
async function readyWorker(){
  channels[0].port1.onmessage({data:{bridgeReady:true}});
  await Promise.resolve();await Promise.resolve();
  channels[1].port1.onmessage({data:{workerReady:true}});
  await Promise.resolve();await Promise.resolve();
}
function reply(id){channels[1].port1.onmessage({data:{id,result:{}}});}

test('slow trusted worker startup gets its own bound, then runtime loading has 500 ms',async()=>{
  const session=createJavaWorkerSession();
  const pending=session.request('initializeRuntime',{workerSource:'trusted'},500);
  const result=pending.catch(error=>error.code);
  await jest.advanceTimersByTimeAsync(650);
  expect(channels[1].port1.postMessage).not.toHaveBeenCalled();
  await readyWorker();
  expect(channels[1].port1.postMessage).toHaveBeenCalledWith(expect.objectContaining({type:'initializeRuntime'}));
  await jest.advanceTimersByTimeAsync(499);
  expect(document.querySelector('iframe')).not.toBeNull();
  reply(1);expect(await result).toEqual({});
  const construct=session.request('construct',{},500).catch(error=>error.code);
  await jest.advanceTimersByTimeAsync(500);
  expect(await construct).toBe('WORKER_TIMEOUT');
  await jest.advanceTimersByTimeAsync(250);
  expect(document.querySelector('iframe')).toBeNull();
});

test('a worker that never starts is terminated after five seconds',async()=>{
  const session=createJavaWorkerSession();
  const result=session.request('initializeRuntime',{workerSource:'trusted'},500).catch(error=>error.code);
  await jest.advanceTimersByTimeAsync(5000);
  expect(await result).toBe('WORKER_TIMEOUT');
  expect(channels[1].port1.postMessage).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(250);
  expect(document.querySelector('iframe')).toBeNull();
});

test('Wasm initialization stays bounded after the startup handshake',async()=>{
  const session=createJavaWorkerSession();
  const result=session.request('initializeRuntime',{workerSource:'trusted'},500).catch(error=>error.code);
  await readyWorker();
  await jest.advanceTimersByTimeAsync(500);
  expect(await result).toBe('WORKER_TIMEOUT');
  await jest.advanceTimersByTimeAsync(250);
  expect(document.querySelector('iframe')).toBeNull();
});

test('cancellation also settles while the worker is starting',async()=>{
  const controller=new AbortController();
  const session=createJavaWorkerSession(controller.signal);
  const result=session.request('initializeRuntime',{workerSource:'trusted'},500).catch(error=>error.code);
  controller.abort();
  expect(await result).toBe('DISPOSED');
  await jest.advanceTimersByTimeAsync(250);
  expect(document.querySelector('iframe')).toBeNull();
});
