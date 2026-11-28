import assert from 'node:assert/strict';
import test from 'node:test';
import starterJavaScriptCode from '../../../frontend/src/tank-editor/editor/starter-code/starterJavaScriptCode.js';
import { createQuickJSTankRuntime } from '../../../frontend/src/game/tank-script/javascript/quickjsTankRuntime.js';
import {
  TANK_SCRIPT_ACTIONS,
  TANK_SCRIPT_LIMITS,
  serializeTankSnapshot,
  tankScriptCommand,
} from '../../../frontend/src/game/tank-script/shared/tankScriptRunnerProtocol.js';
import { createTankScriptApi } from '../../../frontend/src/game/tank-script/shared/tankScriptApi.js';
import easyTank from '../../../frontend/src/game/builtInTanks/easyTank.js';
import mediumTank from '../../../frontend/src/game/builtInTanks/mediumTank.js';
import hardTank from '../../../frontend/src/game/builtInTanks/hardTank.js';
import expertTank from '../../../frontend/src/game/builtInTanks/expertTank.js';
import overkillTank from '../../../frontend/src/game/builtInTanks/overkillTank.js';
import { compileTypeScript } from '../../../frontend/src/game/tank-script/typescript/typeScriptCompiler.js';
import { loadTypeScriptLibraries } from '../../helpers/typeScriptLibraries.cjs';

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

test('runs the actual JavaScript starter', async () => {
  await withRuntime(starterJavaScriptCode, runtime => {
    assert.equal(runtime.runTick(snapshotJSON), 'shoot');
  });
});

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

  assert.deepEqual(JSON.parse(serializeTankSnapshot(snapshot)), JSON.parse(snapshotJSON));
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

test('exposes new arena data through fresh frozen bindings without reserving older local names', async () => {
  const state = { ...makeSnapshot(), tankMaxHealth: 5, tankBulletSpeed: 1, tankLightningTicksRemaining: 12,
    allTanks: allTanks.map(tank => ({ ...tank, maxHealth: 5, bulletSpeed: 1, lightningTicksRemaining: 12 })),
    allBullets: [{ ...makeSnapshot().allBullets[0], speed: 0.5 }],
    allWalls: [{ x: 3, y: 3, health: 7, maxHealth: 10 }],
    allPowerups: [{ type: 'heart', x: 3, y: 4 }, { type: 'lightning', x: 4, y: 3 }],
  };
  await withRuntime(`
    if (tankMaxHealth !== 5 || tankBulletSpeed !== 1 || tankLightningTicksRemaining !== 12) throw Error('status');
    if (allTanks[0].maxHealth !== 5 || allTanks[0].bulletSpeed !== 1 || allTanks[0].lightningTicksRemaining !== 12) throw Error('tank');
    if (allBullets[0].speed !== 0.5 || allPowerups[0].type !== 'heart' || allPowerups[1].type !== 'lightning') throw Error('objects');
    if (![allWalls, allWalls[0], allPowerups, ...allPowerups].every(Object.isFrozen)) throw Error('mutable');
    try { allWalls[0].health = 0; } catch {}
    try { allPowerups[0].x = 99; } catch {}
    if (allWalls[0].health === 7 && allWalls[0].maxHealth === 10 && allPowerups[0].x === 3) shoot();
    allWalls = []; tankBulletSpeed = 99;
  `, runtime => {
    assert.equal(runtime.runTick(serializeTankSnapshot(state)), 'shoot');
    assert.equal(runtime.runTick(serializeTankSnapshot(state)), 'shoot');
    assert.equal(state.allWalls[0].health, 7);
  });
  await withRuntime('const allWalls = [1]; const tankBulletSpeed = 42; if (allWalls.length && tankBulletSpeed) shoot();', runtime => {
    assert.equal(runtime.runTick(snapshotJSON), 'shoot');
  });
  await withRuntime('if (allWalls.length) shoot(); else if (!tankLightningTicksRemaining && tankBulletSpeed === 0.5) moveDown();', runtime => {
    assert.equal(runtime.runTick(serializeTankSnapshot(state)), 'shoot');
    assert.equal(runtime.runTick(snapshotJSON), 'moveDown');
  });
});

test('executes genuine compiled TypeScript using the arena API and legacy local names', async () => {
  const { definitions, libraries } = loadTypeScriptLibraries();
  for (const source of [
    'const walls: readonly Readonly<TankScriptWall>[] = allWalls; if (!walls.length && tankMaxHealth === 3 && tankBulletSpeed === 0.5 && tankLightningTicksRemaining === 0 && allTanks[0].maxHealth === 3 && allBullets[0].speed === 0.5) shoot();',
    'const allWalls: number[] = [1]; const tankBulletSpeed = 99; if (allWalls.length && tankBulletSpeed) shoot();',
  ]) {
    const compiled = compileTypeScript(source, definitions, libraries);
    assert.deepEqual(compiled.diagnostics, []);
    await withRuntime(compiled.javascript, runtime => assert.equal(runtime.runTick(snapshotJSON), 'shoot'));
  }
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
