import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';
import { createTankScriptApi } from '../src/game/tank-script/tankScriptApi.js';
import { executeTankScript } from '../src/game/tank-script/tankScriptExecutor.js';
import { createQuickJSTankRunner } from '../src/game/tank-script/quickjsTankRunner.js';
import easyTank from '../src/game/builtInTanks/easyTank.js';
import mediumTank from '../src/game/builtInTanks/mediumTank.js';
import hardTank from '../src/game/builtInTanks/hardTank.js';
import expertTank from '../src/game/builtInTanks/expertTank.js';
import overkillTank from '../src/game/builtInTanks/overkillTank.js';

const tanks = [easyTank, mediumTank, hardTank, expertTank, overkillTank];
const arenaWidth = 24;
const arenaHeight = 24;
const maxTicks = 1_000;
const vite = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom',
});
const [{ BattleEngine }, { Tank }] = await Promise.all([
  vite.ssrLoadModule('/src/game/engine/battleEngine.js'),
  vite.ssrLoadModule('/src/game/engine/tank.js'),
]);

function createBattleEngine() {
  const engine = new BattleEngine(arenaWidth, arenaHeight);
  const starts = [[1, 1], [11, 1], [22, 1], [1, 22], [11, 22]];
  tanks.forEach((definition, index) => {
    const [x, y] = starts[index];
    engine.addTank(new Tank(
      index + 1,
      definition.name,
      x,
      y,
      definition.code,
      3,
      definition.color,
    ));
  });
  return engine;
}

function captureBattleTick(engine) {
  const allTanks = engine.arena.tanks.map(tank => ({
    id: tank.id,
    name: tank.name,
    x: tank.x,
    y: tank.y,
    rotation: tank.rotation,
    health: tank.health,
  }));
  const allBullets = engine.arena.bullets.map(bullet => ({
    id: bullet.id,
    ownerId: bullet.ownerId,
    x: bullet.x,
    y: bullet.y,
    rotation: bullet.rotation,
  }));

  return engine.arena.tanks.map(tank => ({
    tankId: tank.id,
    tankPosition: { x: tank.x, y: tank.y },
    tankRotation: tank.rotation,
    tankHealth: tank.health,
    allTanks,
    allBullets,
    arenaWidth,
    arenaHeight,
  }));
}

function collectBattleSnapshots(tickCount) {
  const snapshots = [];
  while (snapshots.length < tickCount) {
    let engine = createBattleEngine();
    while (snapshots.length < tickCount) {
      snapshots.push(captureBattleTick(engine));
      if (engine.tick()) break;
    }
  }
  return snapshots;
}

function executeExisting(states) {
  let commandCount = 0;
  for (const state of states) {
    for (let tankIndex = 0; tankIndex < tanks.length; tankIndex += 1) {
      if (state[tankIndex].tankHealth <= 0) continue;
      const api = createTankScriptApi();
      executeTankScript(tanks[tankIndex].code, api, state[tankIndex]);
      if (api.getSubmittedCommand()) commandCount += 1;
    }
  }
  return commandCount;
}

function executeQuickJS(runners, states) {
  let commandCount = 0;
  for (const state of states) {
    for (let tankIndex = 0; tankIndex < runners.length; tankIndex += 1) {
      if (state[tankIndex].tankHealth <= 0) continue;
      const runner = runners[tankIndex];
      if (runner.runTick(state[tankIndex])) commandCount += 1;
    }
  }
  return commandCount;
}

function summarizeQuickJSMemory(runners) {
  return runners.reduce((total, runner) => {
    const usage = runner.getMemoryUsage();
    return total + (usage.memory_used_size || 0);
  }, 0);
}

const runners = await Promise.all(tanks.map(tank => createQuickJSTankRunner(tank.code)));
try {
  const warmup = collectBattleSnapshots(25);
  executeExisting(warmup);
  executeQuickJS(runners, warmup);

  for (const tickCount of [100, 500, maxTicks]) {
    const states = collectBattleSnapshots(tickCount);
    const existingStart = performance.now();
    const existingCommands = executeExisting(states);
    const existingMs = performance.now() - existingStart;

    const quickJSStart = performance.now();
    const quickJSCommands = executeQuickJS(runners, states);
    const quickJSMs = performance.now() - quickJSStart;

    console.log(JSON.stringify({
      ticks: tickCount,
      tankRuns: tickCount * tanks.length,
      existingNewFunctionMs: Number(existingMs.toFixed(2)),
      quickJSReusedRuntimeMs: Number(quickJSMs.toFixed(2)),
      quickJSToExistingRatio: Number((quickJSMs / existingMs).toFixed(2)),
      existingCommands: existingCommands,
      quickJSCommands: quickJSCommands,
      quickJSHeapUsedBytes: summarizeQuickJSMemory(runners),
      quickJSHeapLimitBytes: runners.length * 16 * 1024 * 1024,
    }));
  }
} finally {
  for (const runner of runners) runner.dispose();
  await vite.close();
}
