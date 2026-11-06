import { describe, expect, test } from '@jest/globals';
import { Arena } from '../../../src/game/engine/arena.js';
import { Tank } from '../../../src/game/engine/tank.js';
import {
  canPlaceDebuggerBullet,
  canPlaceDebuggerTank,
  createDefaultDebuggerScenario,
} from '../../../src/tank-editor/debugger/scenario.js';

describe('debugger scenario coordinates', () => {
  test('accepts the engine firing and movement positions in every direction until out of bounds', () => {
    const scenario = createDefaultDebuggerScenario();
    const arena = new Arena(scenario.arenaWidth, scenario.arenaHeight);
    for (const rotation of [0, 90, 180, 270]) {
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) {
          const tank = new Tank(0, 'Player', x, y, '');
          tank.rotation = rotation;
          const bullet = tank.shoot(1);
          for (let tick = 0; tick < 18; tick++) {
            expect(canPlaceDebuggerBullet(scenario, bullet.x, bullet.y))
              .toBe(!arena.isBulletOutOfBounds(bullet));
            bullet.move();
          }
        }
      }
    }
  });

  test.each([[2.5, 3.5], [-0.5, -0.5], [7.5, 7.5], [0.5, 7.5]])(
    'rejects a midpoint on both axes (%s, %s)', (x, y) => {
      expect(canPlaceDebuggerBullet(createDefaultDebuggerScenario(), x, y)).toBe(false);
    },
  );

  test.each([[0.25, 3], [3, 0.75], [NaN, 0], [0, NaN], [Infinity, 0], [0, -Infinity]])(
    'rejects non-half-cell or non-finite bullet coordinates (%s, %s)', (x, y) => {
      expect(canPlaceDebuggerBullet(createDefaultDebuggerScenario(), x, y)).toBe(false);
    },
  );

  test('keeps tank placement on integer cells and respects occupied cells', () => {
    const scenario = createDefaultDebuggerScenario();
    expect(canPlaceDebuggerTank(scenario, 2.5, 3)).toBe(false);
    expect(canPlaceDebuggerTank(scenario, 3, 2.5)).toBe(false);
    expect(canPlaceDebuggerTank(scenario, -0.5, 3)).toBe(false);
    expect(canPlaceDebuggerTank(scenario, 7.5, 3)).toBe(false);
    expect(canPlaceDebuggerTank(scenario, 0, 0)).toBe(true);
    expect(canPlaceDebuggerTank(scenario, 7, 7)).toBe(true);
    expect(canPlaceDebuggerTank(scenario, 1, 1)).toBe(false);
    expect(canPlaceDebuggerTank(scenario, 1, 1, 0)).toBe(true);
  });
});
