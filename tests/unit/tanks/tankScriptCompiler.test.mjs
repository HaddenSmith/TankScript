import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { compileTankScript } from '../../../frontend/src/game/tank-script/typescript/tankScriptCompiler.js';

const originalWorker = globalThis.Worker;
let workers;
let response;
class CompilerWorker {
  constructor() { workers.push(this); }
  postMessage() {
    if (response) queueMicrotask(() => this.onmessage({ data: response }));
  }
  terminate() { this.terminated = true; }
}
beforeEach(() => {
  workers = [];
  response = { javascript: 'shoot();', diagnostics: [] };
  globalThis.Worker = CompilerWorker;
});
after(() => {
  if (originalWorker === undefined) delete globalThis.Worker;
  else globalThis.Worker = originalWorker;
});

test('passes JavaScript through unchanged and rejects unsupported languages without a compiler', async () => {
  const source = 'if (tankHealth) shoot(); // keep the source intact';
  assert.equal(await compileTankScript(source), source);
  await assert.rejects(compileTankScript(source, 'java'), /not available/);
  await assert.rejects(compileTankScript('x'.repeat(100_001), 'typescript'), { code: 'INVALID_SOURCE' });
  assert.equal(workers.length, 0);
});

test('bounds successful compilation caching and disposes every compiler worker', async () => {
  for (let index = 0; index < 11; index++) {
    assert.equal(await compileTankScript('const cache' + index + ': number = 1;', 'typescript'), 'shoot();');
  }
  assert.equal(workers.length, 11);
  await compileTankScript('const cache10: number = 1;', 'typescript');
  assert.equal(workers.length, 11);
  await compileTankScript('const cache0: number = 1;', 'typescript');
  assert.equal(workers.length, 12);
  assert.ok(workers.every(worker => worker.terminated));
});

test('reports compiler diagnostics and allows retrying the same failed source', async () => {
  response = { diagnostics: [{ line: 3, column: 7, message: 'Incorrect type.' }] };
  const source = 'const retry: number = 1;';
  await assert.rejects(compileTankScript(source, 'typescript'), /Line 3, column 7: Incorrect type/);
  response = { javascript: 'moveUp();', diagnostics: [] };
  assert.equal(await compileTankScript(source, 'typescript'), 'moveUp();');
  assert.equal(workers.length, 2);
  assert.ok(workers.every(worker => worker.terminated));
});

test('cancels compilation, terminates its worker, and rejects pre-aborted requests', async () => {
  response = null;
  const controller = new AbortController();
  const compilation = compileTankScript('const cancel: number = 1;', 'typescript', { signal: controller.signal });
  const rejected = assert.rejects(compilation, /cancelled/);
  controller.abort();
  await rejected;
  assert.equal(workers[0].terminated, true);
  await assert.rejects(compileTankScript('const preAbort: number = 1;', 'typescript', { signal: controller.signal }), /cancelled/);
  assert.equal(workers.length, 1);
});

test('bounds compilation time and terminates an unresponsive compiler', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  response = null;
  const compilation = compileTankScript('const timeout: number = 1;', 'typescript');
  const rejected = assert.rejects(compilation, /took too long/);
  context.mock.timers.tick(15_000);
  await rejected;
  assert.equal(workers[0].terminated, true);
});

test('rejects malformed compiler replies and closes the worker', async () => {
  response = { unexpected: true };
  await assert.rejects(compileTankScript('const malformed: number = 1;', 'typescript'), /invalid result/);
  assert.equal(workers[0].terminated, true);
});
