import { createTankScriptWorkerRunner, createTankScriptBattleRunner } from '../../frontend/src/game/tank-script/shared/tankScriptWorkerRunner.js';
import { createBattleFromSelectedTanks } from '../../frontend/src/game/battleController.js';

const output = document.querySelector('#results');
const report = { status: 'RUNNING', checks: [] };
const state = {
  tankId: 1, tankPosition: { x: 1, y: 1 }, tankRotation: 0, tankHealth: 3,
  allTanks: [
    { id: 1, name: 'Python', x: 1, y: 1, rotation: 0, health: 3 },
    { id: 2, name: 'Other', x: 6, y: 6, rotation: 180, health: 3 },
    { id: 3, name: 'JavaScript', x: 5, y: 6, rotation: 0, health: 3 },
  ],
  allBullets: [], arenaWidth: 8, arenaHeight: 8,
};
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function show() { output.textContent = JSON.stringify(report, null, 2); }
async function check(name, run) {
  await run();
  report.checks.push(name);
  show();
}
async function withPython(source, run) {
  const runner = await createTankScriptWorkerRunner(source, { language: 'python' });
  try { await run(runner); }
  finally { await runner.dispose(); }
}
async function expectError(request, code, pattern) {
  try { await request; }
  catch (error) {
    assert(error.code === code || (code === 'COMPILE_ERROR' && error.name === 'TankScriptCompileError'), 'Wrong Python error: ' + error.message);
    if (pattern) assert(pattern.test(error.message), 'Missing source location: ' + error.message);
    return;
  }
  throw new Error('Expected Python error ' + code);
}
try {
  await check('Python commands and initialized interpreter reuse', async () => {
    await withPython('ticks = globals().get("ticks", 0) + 1\nif ticks == 25:\n    move_down()\nelse:\n    shoot()', async runner => {
      assert(document.querySelectorAll('iframe[title="Python execution"]').length === 1, 'Expected one Python interpreter');
      for (let tick = 1; tick <= 25; tick++) {
        const command = await runner.runTick(state);
        assert(command?.action === (tick === 25 ? 'moveDown' : 'shoot'), 'Python state did not persist');
        assert(document.querySelectorAll('iframe[title="Python execution"]').length === 1, 'Reinitialized Python during a tick');
      }
    });
  });
  await check('Python syntax and runtime locations', async () => {
    await expectError(createTankScriptWorkerRunner('if True\n    shoot()', { language: 'python' }), 'COMPILE_ERROR', /Line 1, column/);
    await withPython('shoot()\nraise ValueError("broken")', runner => expectError(runner.runTick(state), 'RUNTIME_ERROR', /Line 2: ValueError: broken/));
  });
  await check('Cooperative execution timeout', async () => {
    await withPython('while True:\n    pass', runner => expectError(runner.runTick(state), 'EXECUTION_TIMEOUT'));
  });
  await check('Opaque origin and inherited script policy', async () => {
    const source = `
ffi = shoot.__globals__["_builtins"].__import__("pyodide.ffi", fromlist=["to_js"])
try:
    ffi.to_js({}).constructor.constructor("return globalThis")()
except BaseException as error:
    assert "EvalError" in str(error), str(error)
    shoot()
else:
    raise AssertionError("Dynamic JavaScript was allowed")
`;
    await withPython(source, async runner => {
      const frame = document.querySelector('iframe[title="Python execution"]');
      assert(frame.contentDocument === null, 'Python frame shares the app origin');
      assert(frame.getAttribute('sandbox') === 'allow-scripts', 'Python frame has extra capabilities');
      assert((await runner.runTick(state))?.action === 'shoot', 'Script policy did not block the JS constructor escape');
    });
  });
  for (const languages of [
    ['python', 'python'], ['python', 'javascript'], ['python', 'typescript'],
    ['python', 'javascript', 'typescript', 'python'],
  ]) {
    await check('Battle: ' + languages.join(' + '), async () => {
      const tanks = languages.map((language, index) => {
        const right = index % 2 === 0;
        const action = right ? 'moveRight' : 'moveLeft';
        return {
          id: String(index), name: language + index, language, color: '#317d84',
          code: language === 'python' ? (right ? 'move_right()' : 'move_left()')
            : language === 'typescript' ? 'const ready: boolean = true; if (ready) ' + action + '();'
            : action + '();',
        };
      });
      const engine = createBattleFromSelectedTanks(tanks, 12);
      const starting = engine.arena.tanks.map(tank => tank.x);
      const runner = await createTankScriptBattleRunner(engine.arena.tanks.map((tank, index) => ({
        tankId: tank.id, source: tank.code, language: tanks[index].language,
      })));
      try {
        for (let tick = 1; tick <= 2; tick++) {
          const { results } = await runner.runTick(engine.getTankScriptStates());
          assert(results.every(result => result.command && !result.error), 'Missing mixed-language command');
          engine.resolveTick(Object.fromEntries(results.map(result => [result.tankId, result.command.action])));
          engine.arena.tanks.forEach((tank, index) => assert(tank.x === starting[index] + tick * (index % 2 === 0 ? 1 : -1), 'Mixed-language tank did not move'));
        }
      } finally { await runner.dispose(); }
    });
  }
  await check('Hard watchdog, healthy participants, and restart recovery', async () => {
    const runner = await createTankScriptBattleRunner([
      { tankId: 1, language: 'python', source: 'shoot.__globals__["_sys"].settrace(None)\nwhile True:\n    pass' },
      { tankId: 2, language: 'python', source: 'shoot()' },
      { tankId: 3, source: 'moveUp();' },
    ]);
    try {
      const states = [1, 2, 3].map(tankId => ({ ...state, tankId }));
      const first = (await runner.runTick(states)).results;
      assert(first[0].error?.code === 'EXECUTION_TIMEOUT', 'Hard watchdog did not stop Python');
      assert(first[1].command?.action === 'shoot' && first[2].command?.action === 'moveUp', 'Healthy tanks were interrupted');
      const startedAt = performance.now();
      const second = (await runner.runTick(states)).results;
      assert(second[0].error?.code === 'EXECUTION_TIMEOUT', 'Timed-out tank was not disabled');
      assert(performance.now() - startedAt < 400, 'Disabled tank executed again');
    } finally { await runner.dispose(); }
    await withPython('move_down()', async fresh => assert((await fresh.runTick(state))?.action === 'moveDown', 'Python could not recover on restart'));
  });
  await check('Initialization cancellation and frame cleanup', async () => {
    const controller = new AbortController();
    const pending = createTankScriptWorkerRunner('shoot()', { language: 'python', signal: controller.signal });
    controller.abort();
    await expectError(pending, 'DISPOSED');
    assert(document.querySelectorAll('iframe[title="Python execution"]').length === 0, 'A Python frame was left running');
  });
  report.status = 'PASS';
  show();
} catch (error) {
  report.status = 'FAIL';
  report.error = error.stack ?? error.message;
  show();
}
