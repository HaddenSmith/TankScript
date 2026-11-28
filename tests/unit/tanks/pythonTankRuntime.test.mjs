import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { loadPyodide } from 'pyodide';
import starterPythonCode from '../../../frontend/src/tank-editor/editor/starter-code/starterPythonCode.js';
import { TANK_SCRIPT_ACTIONS, serializeTankSnapshot } from '../../../frontend/src/game/tank-script/shared/tankScriptRunnerProtocol.js';

let createRunner;
before(async () => {
  const pyodide = await loadPyodide({
    indexURL: fileURLToPath(new URL('../../../node_modules/pyodide/', import.meta.url)),
    enableRunUntilComplete: false, jsglobals: Object.create(null),
    stdout() {}, stderr() {},
  });
  const bootstrap = await fs.readFile(new URL('../../../frontend/src/game/tank-script/python/pythonTankRuntime.py', import.meta.url), 'utf8');
  createRunner = pyodide.runPython(bootstrap);
});
after(() => createRunner?.destroy());

const state = {
  tankId: 17, tankPosition: { x: 2, y: 3 }, tankRotation: 270, tankHealth: 3,
  allTanks: [
    { id: 17, name: 'Python', x: 2, y: 3, rotation: 270, health: 3 },
    { id: 63, name: 'Enemy', x: 5, y: 3, rotation: 180, health: 3 },
  ],
  allBullets: [{ id: 1, ownerId: 63, x: 2.5, y: 3, rotation: 180 }],
  arenaWidth: 12, arenaHeight: 16,
};
async function withRunner(source, run) {
  const runner = createRunner(source, 100);
  assert.equal(typeof runner, 'function', typeof runner === 'string' ? runner : 'Expected compiled Python');
  try { await run(snapshot => JSON.parse(runner(serializeTankSnapshot(snapshot ?? state)))); }
  finally { runner.destroy(); }
}

test('runs the actual Python starter', async () => {
  await withRunner(starterPythonCode, tick => assert.deepEqual(tick(), { action: 'shoot' }));
});

for (const action of TANK_SCRIPT_ACTIONS) {
  const pythonName = action.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
  test('submits ' + pythonName, async () => {
    await withRunner(pythonName + '()', tick => assert.deepEqual(tick(), { action }));
  });
}

test('supports Python functions, loops, imports, and conditional logic', async () => {
  await withRunner(`
import math
import random
import statistics
import collections
import itertools
import functools
import operator
def choose():
    for enemy in all_tanks:
        if enemy.id != tank_id and enemy.health > 0:
            if math.floor(enemy.x) > tank_position.x:
                move_right()
            else:
                move_left()
            return
choose()
`, tick => assert.deepEqual(tick(), { action: 'moveRight' }));
});

test('exposes every snapshot field with natural Python names and read-only records', async () => {
  await withRunner(`
assert tank_id == 17 and tank_position.x == 2 and tank_position.y == 3
assert tank_rotation == 270 and tank_health == 3
assert arena_width == 12 and arena_height == 16
assert isinstance(all_tanks, tuple) and isinstance(all_bullets, tuple)
assert all_tanks[1].id == 63 and all_tanks[1].name == "Enemy"
assert (all_tanks[1].x, all_tanks[1].y, all_tanks[1].rotation, all_tanks[1].health) == (5, 3, 180, 3)
assert (all_bullets[0].id, all_bullets[0].owner_id, all_bullets[0].x, all_bullets[0].y, all_bullets[0].rotation) == (1, 63, 2.5, 3, 180)
shoot()
`, tick => assert.deepEqual(tick(), { action: 'shoot' }));
  for (const source of ['tank_position.x = 99', 'all_tanks[0].health = 99', 'all_bullets[0].owner_id = 17', 'all_tanks[0] = None']) {
    await withRunner(source, tick => assert.equal(tick().error.code, 'RUNTIME_ERROR'));
  }
});

test('exposes equivalent arena and ability fields as immutable Python records, refreshed each tick', async () => {
  const extended = { ...state, tankMaxHealth: 5, tankBulletSpeed: 1, tankLightningTicksRemaining: 34,
    allTanks: state.allTanks.map(tank => ({ ...tank, maxHealth: 5, bulletSpeed: 1, lightningTicksRemaining: 34 })),
    allWalls: [{ x: 3, y: 4, health: 7, maxHealth: 10 }],
    allPowerups: [{ type: 'heart', x: 4, y: 4 }, { type: 'lightning', x: 5, y: 4 }],
  };
  await withRunner(`
assert tank_max_health == 5 and tank_bullet_speed == 1 and tank_lightning_ticks_remaining == 34
assert (all_tanks[0].max_health, all_tanks[0].bullet_speed, all_tanks[0].lightning_ticks_remaining) == (5, 1, 34)
assert all_bullets[0].speed == 0.5
assert isinstance(all_walls, tuple) and isinstance(all_powerups, tuple)
assert (all_walls[0].x, all_walls[0].y, all_walls[0].health, all_walls[0].max_health) == (3, 4, 7, 10)
assert [(p.type, p.x, p.y) for p in all_powerups] == [('heart', 4, 4), ('lightning', 5, 4)]
shoot()
all_walls = ()
tank_bullet_speed = 99
`, tick => {
    assert.deepEqual(tick(extended), { action: 'shoot' });
    assert.deepEqual(tick(extended), { action: 'shoot' });
    assert.equal(extended.allWalls[0].health, 7);
  });
  for (const source of ['all_walls[0].health = 0', 'all_powerups[0].x = 99', 'all_tanks[0].max_health = 99', 'all_bullets[0].speed = 99', 'all_powerups[0] = None']) {
    await withRunner(source, tick => assert.equal(tick(extended).error.code, 'RUNTIME_ERROR'));
  }
  await withRunner(`
if all_walls:
    shoot()
elif not all_powerups and tank_lightning_ticks_remaining == 0 and tank_bullet_speed == 0.5:
    move_down()
`, tick => {
    assert.deepEqual(tick(extended), { action: 'shoot' });
    assert.deepEqual(tick(), { action: 'moveDown' });
  });
});

test('keeps the first action, and accepts ticks without an action', async () => {
  await withRunner('shoot()\nmove_up()', tick => assert.deepEqual(tick(), { action: 'shoot' }));
  await withRunner('value = 3', tick => assert.deepEqual(tick(), { action: null }));
  await withRunner('move_up("shoot")', tick => assert.equal(tick().error.code, 'RUNTIME_ERROR'));
});

test('compiles once, retains private Python variables, and supplies fresh snapshots', async () => {
  await withRunner(`
counter = globals().get("counter", 0) + 1
if counter == 1 and tank_health == 3:
    shoot()
elif counter == 2 and tank_health == 2:
    move_down()
`, tick => {
    assert.deepEqual(tick(), { action: 'shoot' });
    assert.deepEqual(tick({ ...state, tankHealth: 2 }), { action: 'moveDown' });
  });
  await withRunner('assert "counter" not in globals()\nshoot()', tick => assert.deepEqual(tick(), { action: 'shoot' }));
});

test('reports Python syntax and runtime errors with source locations', async () => {
  const invalid = JSON.parse(createRunner('if True\n    shoot()', 100));
  assert.equal(invalid.error.code, 'COMPILE_ERROR');
  assert.equal(invalid.error.line, 1);
  assert.ok(invalid.error.column > 0);
  await withRunner('shoot()\nraise ValueError("broken strategy")', tick => {
    const result = tick();
    assert.equal(result.error.code, 'RUNTIME_ERROR');
    assert.equal(result.error.line, 2);
    assert.match(result.error.message, /ValueError: broken strategy/);
    assert.equal(result.action, undefined);
  });
});

test('interrupts ordinary infinite loops and remains reusable', async () => {
  await withRunner('if tank_health == 2:\n    while True:\n        pass\nshoot()', tick => {
    const started = performance.now();
    assert.equal(tick({ ...state, tankHealth: 2 }).error.code, 'EXECUTION_TIMEOUT');
    assert.ok(performance.now() - started < 2000);
    assert.deepEqual(tick(), { action: 'shoot' });
  });
});

test('blocks direct browser bridges, package installers, and unlisted modules', async () => {
  for (const name of ['js', 'pyodide', 'micropip', 'socket', 'os', 'sys']) {
    await withRunner('import ' + name, tick => {
      assert.equal(tick().error.code, 'RUNTIME_ERROR');
      assert.match(tick().error.message, /ImportError/);
    });
  }
});
