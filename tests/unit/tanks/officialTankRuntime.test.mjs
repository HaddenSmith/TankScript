import assert from 'node:assert/strict';
import test from 'node:test';
import easy from '../../../frontend/src/game/builtInTanks/easyTank.js';
import medium from '../../../frontend/src/game/builtInTanks/mediumTank.js';
import hard from '../../../frontend/src/game/builtInTanks/hardTank.js';
import expert from '../../../frontend/src/game/builtInTanks/expertTank.js';
import overkill from '../../../frontend/src/game/builtInTanks/overkillTank.js';
import { createBattleFromSelectedTanks } from '../../../frontend/src/game/battleController.js';
import { Bullet } from '../../../frontend/src/game/engine/bullet.js';
import { createQuickJSTankRuntime } from '../../../frontend/src/game/tank-script/javascript/quickjsTankRuntime.js';
import { TANK_SCRIPT_ACTIONS, serializeTankSnapshot } from '../../../frontend/src/game/tank-script/shared/tankScriptRunnerProtocol.js';

const definitions = [easy, medium, hard, expert, overkill];
const movement = { moveUp:[0,-1], moveRight:[1,0], moveDown:[0,1], moveLeft:[-1,0] };
function report(context, times, ticks, heap) {
  times.sort((a,b) => a-b);
  context.diagnostic(JSON.stringify({ticks,calls:times.length,p95Ms:times[Math.floor(times.length*0.95)],maxMs:times.at(-1),heapBytes:heap}));
}

for (const size of [8, 20]) {
  for (const [walls, powerups] of [[false,false],[true,false],[false,true],[true,true]]) {
    test(`real QuickJS official battle: ${size} cells, walls ${walls}, powerups ${powerups}`, async context => {
      const originalRandom = Math.random;
      let seed = 7193;
      Math.random = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
      let engine;
      try { engine = createBattleFromSelectedTanks(definitions, size, 3, walls, powerups); }
      finally { Math.random = originalRandom; }
      const runtimes = [];
      const times = [];
      let result;
      let heap = 0;
      try {
        for (const definition of definitions) runtimes.push(await createQuickJSTankRuntime(definition.code));
        for (let tick = 0; tick < 1000 && !result; tick++) {
          const commands = {};
          for (const state of engine.getTankScriptStates()) {
            const snapshot = serializeTankSnapshot(state);
            const started = performance.now();
            const action = runtimes[state.tankId-1].runTick(snapshot);
            times.push(performance.now()-started);
            assert.ok(TANK_SCRIPT_ACTIONS.includes(action));
            const delta = movement[action];
            if (delta) {
              const x = state.tankPosition.x+delta[0], y = state.tankPosition.y+delta[1];
              assert.ok(x>=0 && x<size && y>=0 && y<size);
              assert.ok(!state.allWalls.some(wall=>wall.x===x && wall.y===y));
              assert.ok(!state.allTanks.some(tank=>tank.id!==state.tankId && tank.x===x && tank.y===y));
            }
            commands[state.tankId] = action;
          }
          result = engine.resolveTick(commands);
        }
        assert.ok(result, 'The normal engine limits must finish the battle');
        heap = Math.max(...runtimes.map(runtime=>runtime.getHeapUsageBytes()));
        report(context,times,result.tickCount,heap);
      } finally { for (const runtime of runtimes) runtime.dispose(); }
    });
  }
}

test('Checkmate stays within the real execution budget on a crowded 12-tank snapshot with 200 bullets', async context => {
  const engine = createBattleFromSelectedTanks(Array(12).fill(overkill),20,3,true,true);
  engine.resolveTick({});
  for (let index=0;index<200;index++) {
    const rotation=index%4*90;
    const horizontal=rotation===0 || rotation===180;
    const x=index%18+1+(horizontal?0.5:0);
    const y=Math.floor(index/18)%18+1+(horizontal?0:0.5);
    engine.arena.addBullet(new Bullet(index+1,index%12+1,x,y,rotation,index%2?1:0.5));
  }
  const state=engine.getTankScriptStates()[0];
  const snapshot=serializeTankSnapshot(state);
  const runtime=await createQuickJSTankRuntime(overkill.code);
  const times=[];
  try {
    for (let tick=0;tick<80;tick++) {
      const started=performance.now();
      assert.ok(TANK_SCRIPT_ACTIONS.includes(runtime.runTick(snapshot)));
      times.push(performance.now()-started);
    }
    report(context,times,80,runtime.getHeapUsageBytes());
  } finally { runtime.dispose(); }
});
