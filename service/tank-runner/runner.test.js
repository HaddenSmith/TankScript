import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { connectTankRunner } from './client.js';
import { MAX_REQUEST_BYTES, MAX_REPLY_BYTES, readMessages } from './protocol.js';
import { TANK_SCRIPT_ACTIONS } from '../../src/game/tank-script/tankScriptRunnerProtocol.js';
import firefly from '../../src/game/builtInTanks/easyTank.js';
import bloodhound from '../../src/game/builtInTanks/mediumTank.js';
import sidewinder from '../../src/game/builtInTanks/hardTank.js';
import prism from '../../src/game/builtInTanks/expertTank.js';
import checkmate from '../../src/game/builtInTanks/overkillTank.js';

const entry = fileURLToPath(new URL('./runner.js', import.meta.url));

function spawnFixture(args = [entry], env = {}) {
  return spawn(process.execPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
}

async function withRunner(tanks, callback, env) {
  const child = spawnFixture([entry], env);
  const runner = await connectTankRunner(child, tanks);
  try {
    await callback(runner);
  } finally {
    await runner.dispose();
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  }
}

function snapshot(tankId, overrides = {}) {
  return {
    tankId,
    tankPosition: { x: 2, y: 3 },
    tankRotation: 270,
    tankHealth: 3,
    allTanks: [
      { id: 17, name: 'One', x: 2, y: 3, rotation: 270, health: 3 },
      { id: 63, name: 'Two', x: 5, y: 3, rotation: 180, health: 3 },
    ],
    allBullets: [{ id: 1, ownerId: 17, x: 2, y: 3.5, rotation: 270 }],
    arenaWidth: 12,
    arenaHeight: 16,
    ...overrides,
  };
}

function outcomes({ results }) {
  return results.map(({ tankId, command, error }) => [tankId, command?.action ?? error?.code]);
}

test('supports all seven actions and preserves first action and early return', async () => {
  const tanks = TANK_SCRIPT_ACTIONS.map((action, i) => ({ tankId: i + 1, source: action + '(); shoot(); return;' }));
  await withRunner(tanks, async runner => {
    assert.deepEqual(outcomes(await runner.runTick(tanks.map(({ tankId }) => snapshot(tankId)))),
      TANK_SCRIPT_ACTIONS.map((action, i) => [i + 1, action]));
  });
});

test('keeps private globals and accepts new, frozen snapshots with fractional coordinates', async () => {
  const tanks = [
    { tankId: 17, source: `
      globalThis.turns = (globalThis.turns ?? 0) + 1;
      try { tankPosition.x = 99; } catch {}
      if (turns === 1 && tankPosition.x === 2 && allBullets[0].y === 3.5 &&
          Object.isFrozen(allBullets[0]) && arenaHeight === 16) shoot();
      if (turns === 2 && tankPosition.x === 4 && allBullets.length === 0) moveDown();
    ` },
    { tankId: 63, source: 'if (typeof globalThis.turns === "undefined") rotateRight();' },
  ];
  await withRunner(tanks, async runner => {
    const first = snapshot(17);
    assert.deepEqual(outcomes(await runner.runTick([first, snapshot(63)])), [[17, 'shoot'], [63, 'rotateRight']]);
    const second = snapshot(17, { tankPosition: { x: 4, y: 3 }, allBullets: [] });
    assert.deepEqual(outcomes(await runner.runTick([snapshot(63), second])), [[63, 'rotateRight'], [17, 'moveDown']]);
    assert.equal(first.tankPosition.x, 2);
    assert.ok((await runner.getStats()).peakRssBytes > 0);
  });
});

test('isolates syntax, runtime, unsupported actions and resource failures', async () => {
  const programs = [
    ['return {', 'COMPILE_ERROR'],
    ['shoot(); throw new Error("fixture detail");', 'RUNTIME_ERROR'],
    ['shoot(); unsupportedAction();', 'RUNTIME_ERROR'],
    ['return { action: "shoot" };', undefined],
    ['while (true) {}', 'EXECUTION_TIMEOUT'],
    ['function recurse() { return 1 + recurse(); } recurse();', 'RUNTIME_ERROR'],
    ['const buffer = new ArrayBuffer(32 * 1024 * 1024); if (buffer.byteLength) shoot();', 'RUNTIME_ERROR'],
    ['moveRight();', 'moveRight'],
  ];
  const tanks = programs.map(([source], i) => ({ tankId: i + 1, source }));
  await withRunner(tanks, async runner => {
    assert.equal(runner.initialization[0].error.code, 'COMPILE_ERROR');
    const reply = await runner.runTick(tanks.map(({ tankId }) => snapshot(tankId)));
    assert.deepEqual(outcomes(reply), programs.map(([, result], i) => [i + 1, result]));
    assert.doesNotMatch(reply.results[1].error.message, /fixture detail/);
    assert.deepEqual(outcomes(await runner.runTick([snapshot(8)])), [[8, 'moveRight']]);
  });
});

test('guest has no Node, filesystem, or network capabilities even with a dummy host environment value', async () => {
  await withRunner([{ tankId: 17, source: `
    const absent = ['process', 'require', 'module', 'Buffer', 'fs', 'fetch', 'WebSocket', 'XMLHttpRequest', 'db', 'window'];
    if (absent.every(name => typeof globalThis[name] === 'undefined')) shoot();
  ` }], async runner => {
    assert.deepEqual(outcomes(await runner.runTick([snapshot(17)])), [[17, 'shoot']]);
  }, { TANKSCRIPT_TEST_SECRET: 'dummy-fixture-only' });
});

test('container mode refuses to initialize when required isolation is missing', async () => {
  const child = spawnFixture([entry, '--container'], { TANKSCRIPT_TEST_SECRET: 'dummy-fixture-only' });
  await assert.rejects(connectTankRunner(child, [{ tankId: 17, source: 'shoot();' }]), { code: 'RUNNER_EXIT' });
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test('all current official tanks run on changing arena state', async () => {
  const definitions = [firefly, bloodhound, sidewinder, prism, checkmate];
  const allTanks = definitions.map((tank, i) => ({
    id: i + 1, name: tank.name, x: i * 3 + 1, y: i + 2, rotation: (i % 4) * 90, health: 3,
  }));
  const tanks = definitions.map((tank, i) => ({ tankId: i + 1, source: tank.code }));
  await withRunner(tanks, async runner => {
    for (const x of [2, 3]) {
      const { results } = await runner.runTick(allTanks.map(tank => snapshot(tank.id, {
        tankPosition: { x: tank.x, y: tank.y },
        tankRotation: tank.rotation,
        arenaWidth: 20,
        allTanks,
        allBullets: [{ id: 1, ownerId: 1, x: x + 0.5, y: 2, rotation: 0 }],
      })));
      assert.ok(results.every(({ command, error }) => !error && TANK_SCRIPT_ACTIONS.includes(command?.action)));
    }
  });
});

test('rejects invalid snapshots and bounds caller IPC before writing to the process', async () => {
  await withRunner([{ tankId: 17, source: 'shoot();' }], async runner => {
    await assert.rejects(runner.runTick([snapshot(17, { secret: 'not a permitted field' })]), { code: 'INVALID_REQUEST' });
    await assert.rejects(runner.runTick([snapshot(63)]), { code: 'INVALID_REQUEST' });
    assert.deepEqual(outcomes(await runner.runTick([snapshot(17)])), [[17, 'shoot']]);
  });

  const tanks = Array.from({ length: 12 }, (_, tankId) => ({ tankId, source: '\u0000'.repeat(100_000) }));
  const child = spawnFixture();
  await assert.rejects(connectTankRunner(child, tanks), { code: 'FRAME_LIMIT' });
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

for (const [description, bytes] of [
  ['oversized', Buffer.alloc(MAX_REQUEST_BYTES + 1, 32)],
  ['invalid UTF-8', Buffer.from([0xff, 10])],
  ['partial', Buffer.from('{')],
]) {
  test('terminates on ' + description + ' IPC input', async () => {
    const child = spawnFixture();
    const closed = once(child, 'close');
    child.stderr.resume();
    child.stdout.resume();
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
    assert.notEqual((await closed)[0], 0);
  });
}

test('rejects an out-of-order request and an unexpected request property', async () => {
  for (const [request, expected] of [
    [{ id: 2, type: 'initialize', tanks: [] }, []],
    [{ id: 1, type: 'initialize', tanks: [], extra: true }, [{ id: 1, ok: false, code: 'INVALID_REQUEST' }]],
  ]) {
    const child = spawnFixture();
    const closed = once(child, 'close');
    child.stderr.resume();
    child.stdin.end(JSON.stringify(request) + '\n');
    const replies = [];
    for await (const message of readMessages(child.stdout, MAX_REPLY_BYTES)) replies.push(message);
    assert.deepEqual(replies, expected);
    assert.notEqual((await closed)[0], 0);
  }
});

const fixtureStart = `
  const lines = require('node:readline').createInterface({ input: process.stdin });
  lines.on('line', line => {
    const { id, type } = JSON.parse(line);
    if (type === 'initialize') {
      console.log(JSON.stringify({ id, ok: true, result: { entries: [{ tankId: 17,
        timings: { initializationMs: 0, compilationMs: 0 } }], wasmInitializationMs: 0 } }));
      return;
    }
`;

for (const [description, fixture, code] of [
  ['crashes', 'process.exit(2);', 'RUNNER_EXIT'],
  ['stops responding', '', 'RUNNER_TIMEOUT'],
  ['replies with an invalid action', `console.log(JSON.stringify({ id, ok: true,
    result: { entries: [{ tankId: 17, action: 'invalid' }], executionMs: 0 } }));`, 'PROTOCOL_ERROR'],
]) {
  test('cleans up when the transport ' + description, async () => {
    const child = spawnFixture(['--eval', fixtureStart + fixture + '});']);
    const runner = await connectTankRunner(child, [{ tankId: 17, source: 'shoot();' }]);
    await assert.rejects(runner.runTick([snapshot(17)]), { code });
    await runner.dispose();
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  });
}

test('rejects concurrent requests, aborts in flight and allows repeated startup and cleanup', async () => {
  const tanks = [{ tankId: 17, source: 'shoot();' }];
  const controller = new AbortController();
  const child = spawnFixture(['--eval', fixtureStart + '});']);
  const runner = await connectTankRunner(child, tanks, { signal: controller.signal });
  const inFlight = assert.rejects(runner.runTick([snapshot(17)]), { code: 'DISPOSED' });
  await assert.rejects(runner.runTick([snapshot(17)]), { code: 'BUSY' });
  controller.abort();
  await inFlight;
  await Promise.all([runner.dispose(), runner.dispose()]);
  for (let i = 0; i < 3; i++) {
    await withRunner(tanks, async fresh => {
      assert.deepEqual(outcomes(await fresh.runTick([snapshot(17)])), [[17, 'shoot']]);
    });
  }
});
