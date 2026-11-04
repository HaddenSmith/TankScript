import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuickJSTankRunner, TankScriptExecutionError } from './quickjsTankRunner.js';
import easyTank from '../builtInTanks/easyTank.js';
import mediumTank from '../builtInTanks/mediumTank.js';
import hardTank from '../builtInTanks/hardTank.js';
import expertTank from '../builtInTanks/expertTank.js';
import overkillTank from '../builtInTanks/overkillTank.js';

function createState(overrides = {}) {
  return {
    tankId: 1,
    tankPosition: { x: 3, y: 4 },
    tankRotation: 0,
    tankHealth: 2,
    allTanks: [
      { id: 1, name: 'Self', x: 3, y: 4, rotation: 0, health: 2 },
      { id: 2, name: 'Opponent', x: 8, y: 4, rotation: 180, health: 3 },
    ],
    allBullets: [],
    arenaWidth: 12,
    arenaHeight: 12,
    ...overrides,
  };
}

async function withRunner(code, callback, options) {
  const runner = await createQuickJSTankRunner(code, options);
  try {
    return await callback(runner);
  } finally {
    runner.dispose();
  }
}

test('collects each action currently supported by TankScript', async t => {
  const actions = [
    'moveUp',
    'moveDown',
    'moveLeft',
    'moveRight',
    'rotateLeft',
    'rotateRight',
    'shoot',
  ];

  for (const action of actions) {
    await t.test(action, async () => {
      await withRunner(`${action}();`, runner => {
        assert.deepEqual(runner.runTick(createState()), { action });
      });
    });
  }
});

test('records only the first command in a tick', async () => {
  await withRunner('moveLeft(); shoot(); rotateRight();', runner => {
    assert.deepEqual(runner.runTick(createState()), { action: 'moveLeft' });
  });
});

test('preserves a command when tank code returns early', async () => {
  await withRunner('moveUp(); return; moveDown();', runner => {
    assert.deepEqual(runner.runTick(createState()), { action: 'moveUp' });
  });
});

test('provides TankScript state and freezes nested snapshots', async () => {
  const sourceState = createState();
  await withRunner(`
    if (tankPosition.x === 3 && tankPosition.y === 4 &&
        tankRotation === 0 && tankHealth === 2 &&
        tankId === 1 && allTanks[1].x === 8 &&
        allBullets.length === 0 && arenaWidth === 12 && arenaHeight === 12) {
      shoot();
    }
  `, runner => {
    assert.deepEqual(runner.runTick(sourceState), { action: 'shoot' });
  });

  await withRunner(`
    try { tankPosition.x = 99; } catch {}
    try { allTanks[1].x = 99; } catch {}
    try { Object.setPrototypeOf(tankPosition, { x: 99 }); } catch {}
    if (tankPosition.x === 3 && allTanks[1].x === 8) moveUp();
  `, runner => {
    assert.deepEqual(runner.runTick(sourceState), { action: 'moveUp' });
  });
  assert.equal(sourceState.tankPosition.x, 3);
  assert.equal(sourceState.allTanks[1].x, 8);
});

test('does not expose browser, network, storage, or host application globals', async () => {
  await withRunner(`
    const unavailable = [
      'fetch', 'document', 'window', 'localStorage', 'sessionStorage',
      'indexedDB', 'XMLHttpRequest', 'WebSocket', 'navigator', 'process',
      'require'
    ];
    if (unavailable.some(name => typeof globalThis[name] !== 'undefined')) {
      throw new Error('Unexpected host API');
    }
    shoot();
  `, runner => {
    assert.deepEqual(runner.runTick(createState()), { action: 'shoot' });
  });
});

test('a constructor-based escape only reaches the isolated QuickJS global', async () => {
  await withRunner(`
    const isolatedGlobal = globalThis.constructor.constructor('return globalThis')();
    if (isolatedGlobal !== globalThis || typeof isolatedGlobal.process !== 'undefined') {
      throw new Error('Unexpected host global');
    }
    shoot();
  `, runner => {
    assert.deepEqual(runner.runTick(createState()), { action: 'shoot' });
  });
});

test('resets local variables between repeated ticks', async () => {
  await withRunner(`
    let localCounter = 0;
    localCounter += 1;
    if (localCounter === 1) moveRight();
    else moveLeft();
  `, runner => {
    assert.deepEqual(runner.runTick(createState()), { action: 'moveRight' });
    assert.deepEqual(runner.runTick(createState({ tankPosition: { x: 5, y: 4 } })), { action: 'moveRight' });
  });
});

test('keeps separate tank scripts in separate QuickJS runtimes', async () => {
  const first = await createQuickJSTankRunner('globalThis.secret = 42; moveUp();');
  const second = await createQuickJSTankRunner(`
    if (typeof globalThis.secret === 'undefined') shoot();
    else moveDown();
  `);
  try {
    first.runTick(createState());
    assert.deepEqual(second.runTick(createState()), { action: 'shoot' });
  } finally {
    first.dispose();
    second.dispose();
  }
});

test('rejects invalid JavaScript with a typed compile error', async () => {
  await assert.rejects(
    createQuickJSTankRunner('if ('),
    error => error instanceof TankScriptExecutionError && error.code === 'INVALID_JAVASCRIPT',
  );
});

test('interrupts infinite loops within the configured execution budget', async () => {
  await withRunner('if (tankHealth === 0) while (true) {}; moveUp();', runner => {
    assert.throws(
      () => runner.runTick(createState({ tankHealth: 0 })),
      error => error instanceof TankScriptExecutionError && error.code === 'EXECUTION_TIMEOUT',
    );
    assert.deepEqual(runner.runTick(createState()), { action: 'moveUp' });
  }, { executionTimeMs: 20 });
});

test('enforces the configured QuickJS stack limit', async () => {
  await withRunner('function recurse() { recurse(); } recurse();', runner => {
    assert.throws(
      () => runner.runTick(createState()),
      error => error instanceof TankScriptExecutionError && error.code === 'RUNTIME_ERROR',
    );
  }, { stackLimitBytes: 64 * 1024 });
});

test('enforces the configured QuickJS heap limit', async () => {
  await withRunner(
    'const allocations = new Array(10_000_000).fill("tank"); moveUp();',
    runner => {
      assert.throws(
        () => runner.runTick(createState()),
        error => error instanceof TankScriptExecutionError && error.code === 'MEMORY_LIMIT',
      );
    },
    { executionTimeMs: 500, memoryLimitBytes: 2 * 1024 * 1024 },
  );
});

test('runs all five official tanks against the existing full state API', async () => {
  const officialTanks = [easyTank, mediumTank, hardTank, expertTank, overkillTank];
  const allTanks = officialTanks.map((tank, index) => ({
    id: index + 1,
    name: tank.name,
    x: 2 + index * 3,
    y: 2 + (index % 2) * 5,
    rotation: (index * 90) % 360,
    health: 3,
  }));
  const allBullets = [
    { id: 1, ownerId: 2, x: 7.5, y: 4, rotation: 180 },
    { id: 2, ownerId: 4, x: 9, y: 5.5, rotation: 90 },
  ];
  const runners = await Promise.all(officialTanks.map(tank => createQuickJSTankRunner(tank.code)));

  try {
    for (let index = 0; index < officialTanks.length; index += 1) {
      const ownTank = allTanks[index];
      const command = runners[index].runTick({
        tankId: ownTank.id,
        tankPosition: { x: ownTank.x, y: ownTank.y },
        tankRotation: ownTank.rotation,
        tankHealth: ownTank.health,
        allTanks,
        allBullets,
        arenaWidth: 24,
        arenaHeight: 24,
      });
      assert.ok(command && typeof command.action === 'string', `${officialTanks[index].name} should submit an action`);
    }
  } finally {
    for (const runner of runners) runner.dispose();
  }
});
