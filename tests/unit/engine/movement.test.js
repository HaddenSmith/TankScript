import { describe, expect, test, jest } from '@jest/globals';
import { BattleEngine } from '../../../src/game/engine/battleEngine.js';
import { Tank } from '../../../src/game/engine/tank.js';

function createTank(id, x, y, code = '', health = 3) {
  return new Tank(id, `Tank ${id}`, x, y, code, health);
}

describe('BattleEngine tank actions', () => {
  test.each([
    ['moveUp', [3, 2, 0]],
    ['moveDown', [3, 4, 0]],
    ['moveLeft', [2, 3, 0]],
    ['moveRight', [4, 3, 0]],
    ['rotateLeft', [3, 3, 90]],
    ['rotateRight', [3, 3, 270]],
    ['shoot', [3, 3, 0]],
  ])('resolves %s', (action, [x, y, rotation]) => {
    const engine = new BattleEngine(7, 7);
    const tank = createTank(1, 3, 3, `${action}();`);
    engine.addTank(tank);

    engine.tick();

    expect([tank.x, tank.y, tank.rotation]).toEqual([x, y, rotation]);
    if (action === 'shoot') {
      expect(engine.arena.bullets).toHaveLength(1);
      expect(engine.arena.bullets[0]).toMatchObject({ ownerId: 1, x: 3.5, y: 3 });
    }
  });

  test('keeps a tank inside arena boundaries and ignores scripts without a command', () => {
    const engine = new BattleEngine(4, 4);
    const atEdge = createTank(1, 0, 0, 'moveLeft();');
    const idle = createTank(2, 3, 3, 'const supported = true;');
    engine.addTank(atEdge);
    engine.addTank(idle);

    engine.tick();

    expect([atEdge.x, atEdge.y]).toEqual([0, 0]);
    expect([idle.x, idle.y]).toEqual([3, 3]);
  });

  test('uses the first action submitted in a tick', () => {
    const engine = new BattleEngine(5, 5);
    const tank = createTank(1, 2, 2, 'moveUp(); moveRight(); shoot();');
    engine.addTank(tank);

    engine.tick();

    expect([tank.x, tank.y]).toEqual([2, 1]);
    expect(engine.arena.bullets).toHaveLength(0);
  });

  test('collects actions from the same pre-resolution tank snapshot', () => {
    const engine = new BattleEngine(7, 7);
    const first = createTank(1, 1, 1, 'if (allTanks.find(t => t.id === 2).x === 3) moveUp();');
    const second = createTank(2, 3, 3, 'if (allTanks.find(t => t.id === 1).x === 1) moveDown();');
    engine.addTank(first);
    engine.addTank(second);

    engine.tick();

    expect([first.x, first.y]).toEqual([1, 0]);
    expect([second.x, second.y]).toEqual([3, 4]);
  });

  test('blocks simultaneous movement into the same cell and position swaps', () => {
    const collision = new BattleEngine(5, 5);
    const left = createTank(1, 1, 2, 'moveRight();');
    const right = createTank(2, 3, 2, 'moveLeft();');
    collision.addTank(left);
    collision.addTank(right);
    collision.tick();
    expect([left.x, right.x]).toEqual([1, 3]);

    const swap = new BattleEngine(5, 5);
    const first = createTank(1, 1, 1, 'moveRight();');
    const second = createTank(2, 2, 1, 'moveLeft();');
    swap.addTank(first);
    swap.addTank(second);
    swap.tick();
    expect([first.x, second.x]).toEqual([1, 2]);
  });

  test('dead tanks do not execute commands', () => {
    const engine = new BattleEngine(5, 5);
    const tank = createTank(1, 2, 2, 'moveRight();', 0);
    engine.addTank(tank);

    engine.tick();

    expect([tank.x, tank.y]).toEqual([2, 2]);
  });

  test('logs malformed scripts without interrupting other tanks', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const engine = new BattleEngine(5, 5);
    const invalid = createTank(1, 1, 1, 'moveUp(');
    const valid = createTank(2, 3, 3, 'moveLeft();');
    engine.addTank(invalid);
    engine.addTank(valid);

    engine.tick();

    expect(error).toHaveBeenCalled();
    expect([valid.x, valid.y]).toEqual([2, 3]);
    error.mockRestore();
  });
});
