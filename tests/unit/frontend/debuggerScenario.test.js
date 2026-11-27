import { describe, expect, test } from '@jest/globals';
import { Arena } from '../../../frontend/src/game/engine/arena.js';
import { Tank } from '../../../frontend/src/game/engine/tank.js';
import {
  canPlaceDebuggerBullet,
  canPlaceDebuggerTank,
  canPlaceDebuggerWall,
  canPlaceDebuggerPowerup,
  createDebuggerTankState,
  createDefaultDebuggerScenario,
} from '../../../frontend/src/tank-editor/debugger/scenario.js';

describe('debugger scenario coordinates', () => {
  test('validates power-up positions and prevents reciprocal overlaps without adding scripting fields', () => {
    const scenario = createDefaultDebuggerScenario();
    scenario.hearts.push({ id: 1, x: 3, y: 2 });
    scenario.lightnings.push({ id: 2, x: 4, y: 2 });
    scenario.walls.push({ id: 1, x: 5, y: 2, health: 10 });
    scenario.allBullets.push({ id: 1, x: 6.5, y: 2 });
    for (const [x, y] of [[-1, 0], [0, 8], [0.5, 2], [NaN, 2], [1, 1], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2]]) {
      expect(canPlaceDebuggerPowerup(scenario, x, y)).toBe(false);
    }
    expect(canPlaceDebuggerPowerup(scenario, 0, 0)).toBe(true);
    expect(canPlaceDebuggerPowerup(scenario, 3, 2, 1)).toBe(true);
    expect(canPlaceDebuggerTank(scenario, 3, 2)).toBe(false);
    expect(canPlaceDebuggerWall(scenario, 3, 2)).toBe(false);
    expect(canPlaceDebuggerBullet(scenario, 3.5, 2)).toBe(false);
    expect(createDebuggerTankState(scenario)).not.toHaveProperty('hearts');
    expect(createDebuggerTankState(scenario)).not.toHaveProperty('lightnings');
  });
  test('keeps visual walls outside the scripting snapshot and rejects invalid or occupied wall cells', () => {
    const scenario = createDefaultDebuggerScenario();
    scenario.walls.push({ id: 1, x: 3, y: 2, health: 10, maxHealth: 10 });
    scenario.allBullets.push({ id: 1, x: 4, y: 2 });
    for (const [x, y] of [[-1, 2], [8, 2], [2.5, 2], [NaN, 2], [1, 1], [3, 2], [4, 2]]) {
      expect(canPlaceDebuggerWall(scenario, x, y)).toBe(false);
    }
    expect(canPlaceDebuggerWall(scenario, 0, 0)).toBe(true);
    expect(canPlaceDebuggerWall(scenario, 7, 7)).toBe(true);
    expect(canPlaceDebuggerWall(scenario, 3, 2, 1)).toBe(true);
    expect(canPlaceDebuggerTank(scenario, 3, 2)).toBe(false);
    expect(createDebuggerTankState(scenario)).not.toHaveProperty('walls');
  });
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
