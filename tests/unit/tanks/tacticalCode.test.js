import { describe, expect, test, jest } from '@jest/globals';
import { geometryCode } from '../../../src/game/builtInTanks/tacticalCode.js';
import { createTankScriptApi } from '../../../src/game/tank-script/tankScriptApi.js';
import { executeTankScript } from '../../../src/game/tank-script/tankScriptExecutor.js';
import { BattleEngine } from '../../../src/game/engine/battleEngine.js';
import { Tank } from '../../../src/game/engine/tank.js';
import { Bullet } from '../../../src/game/engine/bullet.js';
import easy from '../../../src/game/builtInTanks/easyTank.js';
import medium from '../../../src/game/builtInTanks/mediumTank.js';
import hard from '../../../src/game/builtInTanks/hardTank.js';
import expert from '../../../src/game/builtInTanks/expertTank.js';
import overkill from '../../../src/game/builtInTanks/overkillTank.js';

const definitions = [easy, medium, hard, expert, overkill];
const actions = ['moveUp', 'moveDown', 'moveLeft', 'moveRight', 'rotateLeft', 'rotateRight', 'shoot'];
function freeze(value) {
  Object.values(value).forEach(child => { if (child && typeof child === 'object') freeze(child); });
  return Object.freeze(value);
}
function state() {
  return freeze({ tankId: 1, tankPosition: { x: 2, y: 2 }, tankRotation: 0, tankHealth: 3,
    arenaWidth: 8, arenaHeight: 8,
    allTanks: [{ id: 1, x: 2, y: 2, health: 3, rotation: 0 },
      { id: 2, x: 5, y: 5, health: 3, rotation: 180 }],
    allBullets: [] });
}

describe('tactical geometry and official script safety', () => {
  test.each([
    ['moveRight', 3, 2, 180], ['moveLeft', 1, 2, 0],
    ['moveUp', 2, 1, 270], ['moveDown', 2, 3, 90],
  ])('path prediction matches actual half-cell damage for %s', (action, x, y, rotation) => {
    const snapshot = { ...state(), allBullets: [{ id: 20, ownerId: 1, x, y, rotation }] };
    const api = createTankScriptApi();
    executeTankScript(geometryCode + `
const destination = moves.find(move => move.name === '${action}');
if (bulletPathDanger(me, { x: me.x + destination.x, y: me.y + destination.y }, 1)) shoot();
else rotateLeft();`, api, snapshot);
    expect(api.getSubmittedCommand()).toEqual({ action: 'shoot' });
    const engine = new BattleEngine(8, 8);
    const tank = new Tank(1, 'Mover', 2, 2, `${action}();`);
    engine.addTank(tank);
    engine.addTank(new Tank(2, 'Opponent', 5, 5, ''));
    engine.arena.addBullet(new Bullet(20, 1, x, y, rotation));
    engine.tick();
    expect(tank.health).toBe(2);
  });

  test.each(definitions.map(tank => [tank.name, tank]))('%s executes without mutations, leaked globals or extra actions', (_name, tank) => {
    const originalGlobals = Reflect.ownKeys(globalThis);
    const random = jest.spyOn(Math, 'random');
    try {
      for (const rotation of [0, 90, 180, 270]) {
        for (const health of [1, 2, 3]) {
          // Exercise both normal choices and occasional flanking branches.
          for (const chance of [0, 0.5, 0.99]) {
            random.mockReturnValue(chance);
            const snapshot = state();
            const scenario = freeze({ ...snapshot, tankRotation: rotation, tankHealth: health,
              allTanks: [...snapshot.allTanks, { id: 3, x: 1, y: 3, rotation: 90, health: 1 }],
              allBullets: [{ id: 20, ownerId: 2, x: 3, y: 2, rotation: 180 },
                { id: 21, ownerId: 3, x: 1, y: 2.5, rotation: 90 }] });
            const api = createTankScriptApi();
            const submitted = [];
            const observedApi = Object.fromEntries(actions.map(action => [action, () => {
              submitted.push(action);
              api[action]();
            }]));
            expect(() => executeTankScript(tank.code, observedApi, scenario)).not.toThrow();
            expect(submitted).toHaveLength(1);
            expect(actions).toContain(api.getSubmittedCommand()?.action);
          }
        }
      }
      expect(Reflect.ownKeys(globalThis)).toEqual(originalGlobals);
    } finally { random.mockRestore(); }
  });

  test.each(definitions.map(tank => [tank.name, tank]))('%s does not invent an action without a live opponent', (_name, tank) => {
    const snapshot = state();
    const api = createTankScriptApi();
    executeTankScript(tank.code, api, freeze({ ...snapshot,
      allTanks: [snapshot.allTanks[0], { ...snapshot.allTanks[1], health: 0 }] }));
    expect(api.getSubmittedCommand()).toBeUndefined();
  });

  test('predicts future turn costs without assuming movement changes the turret', () => {
    const api = createTankScriptApi();
    executeTankScript(geometryCode + `
if (approachTurns({ x: 2, y: 2, rotation: 180 }, { x: 1, y: 1 }) === 0 &&
    approachTurns({ x: 2, y: 2, rotation: 0 }, { x: 1, y: 1 }) === 1) shoot();`, api, state());
    expect(api.getSubmittedCommand()).toEqual({ action: 'shoot' });
  });
});
