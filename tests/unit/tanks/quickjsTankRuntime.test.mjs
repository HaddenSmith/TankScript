import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuickJSTankRuntime } from '../../../shared/game/tank-script/quickjsTankRuntime.js';
import {
  TANK_SCRIPT_ACTIONS,
  TANK_SCRIPT_LIMITS,
  serializeTankSnapshot,
  tankScriptCommand,
} from '../../../shared/game/tank-script/tankScriptRunnerProtocol.js';
import { createTankScriptApi } from '../../../shared/game/tank-script/tankScriptApi.js';
import easyTank from '../../../shared/game/builtInTanks/easyTank.js';
import mediumTank from '../../../shared/game/builtInTanks/mediumTank.js';
import hardTank from '../../../shared/game/builtInTanks/hardTank.js';
import expertTank from '../../../shared/game/builtInTanks/expertTank.js';
import overkillTank from '../../../shared/game/builtInTanks/overkillTank.js';

const officialTanks = [easyTank, mediumTank, hardTank, expertTank, overkillTank];
const allTanks = officialTanks.map((tank, index) => ({
  id: index + 1,
  name: tank.name,
  x: 1 + index * 3,
  y: 2 + index,
  rotation: index % 4 * 90,
  health: 3,
}));

function makeSnapshot(tank = allTanks[0]) {
  return {
    tankId: tank.id,
    tankPosition: { x: tank.x, y: tank.y },
    tankRotation: tank.rotation,
    tankHealth: tank.health,
    allTanks,
    allBullets: [{ id: 1, ownerId: 2, x: 2.5, y: 2, rotation: 180 }],
    arenaWidth: 20,
    arenaHeight: 20,
  };
}

async function withRuntime(source, callback) {
  const runtime = await createQuickJSTankRuntime(source);
  try {
    return callback(runtime);
  } finally {
    runtime.dispose();
  }
}

const snapshotJSON = serializeTankSnapshot(makeSnapshot());

test('the runner allowlist matches the current TankScript API', () => {
  const { getSubmittedCommand, ...actions } = createTankScriptApi();
  assert.deepEqual(TANK_SCRIPT_ACTIONS, Object.keys(actions));
});

for (const action of TANK_SCRIPT_ACTIONS) {
  test('collects ' + action, async () => {
    await withRuntime(action + '();', runtime => {
      assert.equal(runtime.runTick(snapshotJSON), action);
    });
  });
}

test('keeps the first action when the script returns early', async () => {
  await withRuntime('moveLeft(); shoot(); return; moveRight();', runtime => {
    assert.equal(runtime.runTick(snapshotJSON), 'moveLeft');
  });
});

test('ignores direct returns and reports no action when nothing was submitted', async () => {
  await withRuntime('return { action: "shoot" };', runtime => {
    assert.equal(runtime.runTick(snapshotJSON), undefined);
  });
});

test('reports a compile error for malformed JavaScript', async () => {
  await assert.rejects(createQuickJSTankRuntime('return {'), { code: 'COMPILE_ERROR' });
});

test('discards a previously submitted action when the script throws', async () => {
  await withRuntime('shoot(); throw new Error("test error");', runtime => {
    assert.throws(() => runtime.runTick(snapshotJSON), { code: 'RUNTIME_ERROR' });
  });
});

test('interrupts a loop within the interpreter budget', async () => {
  await withRuntime('while (true) {}', runtime => {
    assert.throws(() => runtime.runTick(snapshotJSON), { code: 'EXECUTION_TIMEOUT' });
  });
});

for (const [limit, source] of [
  ['stack', 'function recurse() { return 1 + recurse(); } recurse();'],
  ['heap', 'const values = new Array(2_000_000).fill(1); if (values.length) shoot();'],
]) {
  test('bounds guest ' + limit + ' use', async () => {
    await withRuntime(source, runtime => {
      assert.throws(() => runtime.runTick(snapshotJSON), { code: 'RUNTIME_ERROR' });
    });
  });
}

test('provides neither browser capabilities nor Node or application globals', async () => {
  await withRuntime(`
    const forbidden = [
      'window', 'document', 'localStorage', 'sessionStorage', 'indexedDB',
      'fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'postMessage', 'self',
      'process', 'require', 'module', 'Buffer', 'db',
    ];
    if (forbidden.every(name => typeof globalThis[name] === 'undefined')) shoot();
  `, runtime => {
    assert.equal(runtime.runTick(snapshotJSON), 'shoot');
  });
});

test('serializes only permitted fields and preserves fractional coordinates', () => {
  const snapshot = makeSnapshot();
  snapshot.privateValue = 'not in the API';
  snapshot.tankPosition.privateValue = 'not in the API';
  snapshot.allTanks = snapshot.allTanks.map(tank => ({ ...tank, code: 'private source' }));
  snapshot.allBullets[0].privateValue = 'not in the API';

  assert.deepEqual(JSON.parse(serializeTankSnapshot(snapshot)), makeSnapshot());
  snapshot.allBullets[0].x = Infinity;
  assert.throws(() => serializeTankSnapshot(snapshot), { code: 'INVALID_SNAPSHOT' });
});

test('bounds source and snapshot input', async () => {
  await assert.rejects(createQuickJSTankRuntime(' '.repeat(TANK_SCRIPT_LIMITS.sourceLength + 1)), { code: 'INVALID_SOURCE' });

  const snapshot = makeSnapshot();
  snapshot.allBullets = Array(4_097).fill(snapshot.allBullets[0]);
  assert.throws(() => serializeTankSnapshot(snapshot), { code: 'INVALID_SNAPSHOT' });
});

test('uses a fresh, deeply frozen snapshot even after guest globals change', async () => {
  await withRuntime(`
    const frozen = Object.isFrozen(tankPosition) && Object.isFrozen(allTanks) &&
      Object.isFrozen(allTanks[0]) && Object.isFrozen(allBullets) && Object.isFrozen(allBullets[0]);
    try { tankPosition.x = 99; } catch {}
    try { allBullets[0].x = 99; } catch {}
    if (frozen && tankPosition.x === 1 && allBullets[0].x === 2.5) shoot();
    JSON.parse = () => null;
    Object.freeze = () => null;
    Object.keys = () => [];
  `, runtime => {
    assert.equal(runtime.runTick(snapshotJSON), 'shoot');
    assert.equal(runtime.runTick(snapshotJSON), 'shoot');
    assert.equal(makeSnapshot().allBullets[0].x, 2.5);
  });
});

test('rejects unknown actions and command-shaped objects from a runner', () => {
  assert.equal(tankScriptCommand(undefined), undefined);
  assert.deepEqual(tankScriptCommand('shoot'), { action: 'shoot' });
  for (const result of ['teleport', { action: 'shoot' }, null]) {
    assert.throws(() => tankScriptCommand(result), { code: 'INVALID_COMMAND' });
  }
});

test('can dispose a runtime twice and rejects subsequent ticks', async () => {
  const runtime = await createQuickJSTankRuntime('shoot();');
  assert.ok(runtime.getHeapUsageBytes() > 0);
  runtime.dispose();
  runtime.dispose();
  assert.throws(() => runtime.runTick(snapshotJSON), { code: 'DISPOSED' });
});

for (const [index, tank] of officialTanks.entries()) {
  test('runs the current ' + tank.name + ' source on a valid arena snapshot', async () => {
    await withRuntime(tank.code, runtime => {
      const action = runtime.runTick(serializeTankSnapshot(makeSnapshot(allTanks[index])));
      assert.ok(TANK_SCRIPT_ACTIONS.includes(action));
    });
  });
}

test('passes names containing quotes and line breaks as snapshot data', async () => {
  const name = 'Tank "test"\nSecond line';
  const snapshot = makeSnapshot();
  snapshot.allTanks = snapshot.allTanks.map((tank, index) => index === 0 ? { ...tank, name } : tank);
  await withRuntime(`
    if (allTanks[0].name === ${JSON.stringify(name)} && Object.isFrozen(allTanks[0])) shoot();
  `, runtime => {
    assert.equal(runtime.runTick(serializeTankSnapshot(snapshot)), 'shoot');
  });
});

test('checks the serialized snapshot length after JSON escaping', () => {
  const snapshot = makeSnapshot();
  const name = '\n'.repeat(TANK_SCRIPT_LIMITS.snapshotLength / 2);
  snapshot.allTanks = [{ ...snapshot.allTanks[0], name }];
  assert.throws(() => serializeTankSnapshot(snapshot), { code: 'INVALID_SNAPSHOT' });
});
