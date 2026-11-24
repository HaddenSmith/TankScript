import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { Arena } from '../../../frontend/src/game/engine/arena.js';
import { Wall } from '../../../frontend/src/game/engine/wall.js';
import { Tank } from '../../../frontend/src/game/engine/tank.js';

afterEach(() => jest.restoreAllMocks());

function randomSource(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

describe('Wall', () => {
  test('keeps its position, default health and original maximum health', () => {
    const wall = new Wall(2, 3);
    expect(wall).toMatchObject({ x: 2, y: 3, health: 10, maxHealth: 10 });
    expect(wall.isDestroyed()).toBe(false);
    wall.takeDamage();
    expect(wall.health).toBe(9);
    expect(wall.maxHealth).toBe(10);
  });

  test('supports custom health, zero damage and fractional damage', () => {
    const wall = new Wall(2, 3, 2);
    wall.takeDamage(0);
    expect(wall.health).toBe(2);
    wall.takeDamage(0.5);
    expect(wall.health).toBe(1.5);
    expect(wall.maxHealth).toBe(2);
  });

  test('clamps lethal and repeated damage at zero', () => {
    const wall = new Wall(2, 3, 2);
    wall.takeDamage(10);
    wall.takeDamage();
    expect(wall.health).toBe(0);
    expect(wall.maxHealth).toBe(2);
    expect(wall.isDestroyed()).toBe(true);
    expect(new Wall(0, 0, 0).isDestroyed()).toBe(true);
  });
});

describe('Arena wall placement', () => {
  test('starts without walls and does not use randomness unless requested', () => {
    const random = jest.spyOn(Math, 'random');
    expect(new Arena(8, 8).walls).toEqual([]);
    expect(new Arena(8, 8, false).walls).toEqual([]);
    expect(random).not.toHaveBeenCalled();
    expect(new Arena(8, 8, true).walls.length).toBeGreaterThan(0);
  });

  test('looks up living and destroyed walls without treating destroyed walls as occupied', () => {
    const arena = new Arena(8, 8);
    const wall = new Wall(3, 4);
    arena.addWall(wall);
    expect(arena.getWallByPosition(3, 4)).toBe(wall);
    expect(arena.isPositionOccupiedByWall(3, 4)).toBe(true);
    expect(arena.getWallByPosition(2, 4)).toBeUndefined();
    wall.takeDamage(10);
    expect(arena.getWallByPosition(3, 4)).toBe(wall);
    expect(arena.isPositionOccupiedByWall(3, 4)).toBe(false);
  });

  test.each([[-1, 0], [0, -1], [8, 0], [0, 6], [0.5, 2], [2, NaN], [Infinity, 2]])('rejects invalid wall coordinates (%s, %s)', (x, y) => {
    const arena = new Arena(8, 6);
    expect(() => arena.addWall(new Wall(x, y))).toThrow(/in-bounds grid cell/);
    expect(arena.walls).toEqual([]);
  });

  test('accepts all four boundary corners for manually placed walls', () => {
    const arena = new Arena(8, 6);
    for (const [x, y] of [[0, 0], [7, 0], [0, 5], [7, 5]]) arena.addWall(new Wall(x, y));
    expect(arena.walls).toHaveLength(4);
  });

  test('rejects duplicate coordinates even if the stored wall was destroyed', () => {
    const arena = new Arena(8, 8);
    const wall = new Wall(1, 1);
    arena.addWall(wall);
    expect(() => arena.addWall(new Wall(1, 1))).toThrow(/already occupies/);
    wall.takeDamage(10);
    expect(() => arena.addWall(new Wall(1, 1))).toThrow(/already occupies/);
    expect(arena.walls).toEqual([wall]);
  });

  test('rejects tanks inside living walls, including through an ordinary tank object', () => {
    const arena = new Arena(8, 8);
    const wall = new Wall(1, 1);
    arena.addWall(wall);
    expect(() => arena.addTank(new Tank(1, 'Blocked', 1, 1, ''))).toThrow(/living wall/);
    expect(() => arena.addTank({ id: 2, x: 1, y: 1 })).toThrow(/living wall/);
    expect(arena.tanks).toEqual([]);
    wall.takeDamage(10);
    arena.addTank(new Tank(1, 'Allowed', 1, 1, ''));
    expect(arena.tanks).toHaveLength(1);
  });

  test.each([0, 3])('does not place walls on tanks or wrecks (health %i)', health => {
    const arena = new Arena(8, 8);
    arena.addTank(new Tank(1, 'Reserved', 1, 1, '', health));
    expect(() => arena.addWall(new Wall(1, 1))).toThrow(/on a tank/);
    expect(arena.walls).toEqual([]);
  });
});

describe('random wall generation', () => {
  test.each([
    [1, 1], [2, 7], [3, 3], [4, 9], [5, 5], [6, 6], [7, 7],
    [8, 8], [9, 9], [12, 8], [8, 12], [20, 20], [20, 8], [8, 20],
  ])('keeps clusters valid, unique and out of the central lanes in a %i × %i arena', (width, height) => {
    const random = jest.spyOn(Math, 'random');
    for (let seed = 0; seed < 10; seed++) {
      random.mockImplementation(randomSource(seed));
      const arena = new Arena(width, height, true);
      const positions = new Set(arena.walls.map(wall => `${wall.x},${wall.y}`));
      expect(positions.size).toBe(arena.walls.length);
      let eligible = 0;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          if (Math.abs(x - (width - 1) / 2) >= 1 && Math.abs(y - (height - 1) / 2) >= 1) eligible++;
        }
      }
      expect(arena.walls.length).toBeLessThanOrEqual(Math.min(eligible, Math.max(2, Math.floor(eligible * 0.12))));
      for (const wall of arena.walls) {
        expect(wall).toBeInstanceOf(Wall);
        expect(Number.isInteger(wall.x) && Number.isInteger(wall.y)).toBe(true);
        expect(wall.x).toBeGreaterThan(0);
        expect(wall.x).toBeLessThan(width - 1);
        expect(wall.y).toBeGreaterThan(0);
        expect(wall.y).toBeLessThan(height - 1);
        expect(Math.abs(wall.x - (width - 1) / 2)).toBeGreaterThanOrEqual(1);
        expect(Math.abs(wall.y - (height - 1) / 2)).toBeGreaterThanOrEqual(1);
        expect(wall.health).toBe(10);
        expect([[wall.x - 1, wall.y], [wall.x + 1, wall.y], [wall.x, wall.y - 1], [wall.x, wall.y + 1]]
          .some(([x, y]) => positions.has(`${x},${y}`))).toBe(true);
      }
      if (width >= 8 && height >= 8) {
        expect(arena.walls.length).toBeGreaterThanOrEqual(Math.floor(eligible * 0.12) - 1);
        expect(arena.walls.length).toBeGreaterThan(0);
      }
    }
  });

  test.each([0, 0.999999])('terminates with an extreme repeating random source (%s)', value => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(value);
    const arena = new Arena(20, 20, true);
    expect(arena.walls.length).toBeGreaterThan(0);
    expect(random.mock.calls.length).toBeLessThan(200);
  });

  test('reproduces the same layout for the same random sequence', () => {
    const random = jest.spyOn(Math, 'random').mockImplementation(randomSource(42));
    const first = new Arena(20, 12, true).walls;
    random.mockImplementation(randomSource(42));
    expect(new Arena(20, 12, true).walls).toEqual(first);
  });

  test('generates around existing tanks and replaces layouts without duplicates', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const arena = new Arena(12, 8);
    arena.addTank(new Tank(1, 'Living', 1, 1, ''));
    arena.addTank(new Tank(2, 'Wreck', 2, 1, '', 0));
    arena.generateWalls();
    expect(arena.walls.length).toBeGreaterThan(0);
    const first = arena.walls;
    arena.generateWalls();
    expect(arena.walls).toEqual(first);
    expect(arena.walls).not.toBe(first);
    expect(arena.isPositionOccupiedByWall(1, 1)).toBe(false);
    expect(arena.isPositionOccupiedByWall(2, 1)).toBe(false);
  });

  test('returns an empty layout when every eligible cell is reserved for tanks', () => {
    const arena = new Arena(8, 8);
    for (let y = 1; y < 7; y++) {
      for (let x = 1; x < 7; x++) arena.addTank({ id: y * 8 + x, x, y });
    }
    const random = jest.spyOn(Math, 'random');
    arena.generateWalls();
    expect(arena.walls).toEqual([]);
    expect(random).not.toHaveBeenCalled();
  });
});
