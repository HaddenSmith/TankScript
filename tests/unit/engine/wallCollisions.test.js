import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { BattleEngine } from '../../../frontend/src/game/engine/battleEngine.js';
import { Tank } from '../../../frontend/src/game/engine/tank.js';
import { Bullet } from '../../../frontend/src/game/engine/bullet.js';
import { Wall } from '../../../frontend/src/game/engine/wall.js';

afterEach(() => jest.restoreAllMocks());

function addTank(engine, id, x, y, health = 3) {
  const tank = new Tank(id, `Tank ${id}`, x, y, '', health);
  engine.addTank(tank);
  return tank;
}

function addWall(engine, x, y, health = 10) {
  const wall = new Wall(x, y, health);
  engine.arena.addWall(wall);
  return wall;
}

describe('tanks and destructible walls', () => {
  test('forwards the opt-in flag and keeps walls disabled by default', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    expect(new BattleEngine(8, 8).arena.walls).toEqual([]);
    expect(new BattleEngine(8, 8, false).arena.walls).toEqual([]);
    const engine = new BattleEngine(8, 8, true);
    expect(engine.arena.walls.length).toBeGreaterThan(0);
    const wall = engine.arena.walls[0];
    expect(() => addTank(engine, 1, wall.x, wall.y)).toThrow(/living wall/);
  });

  test.each([
    ['moveUp', 3, 2], ['moveDown', 3, 4], ['moveLeft', 2, 3], ['moveRight', 4, 3],
  ])('blocks %s for every facing without damaging the tank or wall', (action, x, y) => {
    for (const rotation of [0, 90, 180, 270]) {
      const engine = new BattleEngine(8, 8);
      const tank = addTank(engine, 1, 3, 3);
      tank.rotation = rotation;
      const wall = addWall(engine, x, y);
      engine.resolveTick({ 1: action });
      expect([tank.x, tank.y, tank.rotation, tank.health]).toEqual([3, 3, rotation, 3]);
      expect(wall.health).toBe(10);
      expect(engine.getLastTickEvents()).toEqual([]);
    }
  });

  test('also blocks movement submitted by an actual tank script', () => {
    const engine = new BattleEngine(8, 8);
    const tank = addTank(engine, 1, 3, 3);
    tank.rotation = 0;
    tank.code = 'moveLeft();'; // Backward relative to this tank's facing.
    addWall(engine, 2, 3);
    engine.tick();
    expect([tank.x, tank.y, tank.health]).toEqual([3, 3, 3]);
  });

  test('allows rotation, shooting and movement away from a living wall', () => {
    const engine = new BattleEngine(8, 8);
    const tank = addTank(engine, 1, 3, 3);
    addWall(engine, 4, 3);
    engine.resolveTick({ 1: 'rotateLeft' });
    expect(tank.rotation).toBe(90);
    engine.resolveTick({ 1: 'shoot' });
    expect(engine.arena.bullets).toHaveLength(1);
    engine.resolveTick({ 1: 'moveLeft' });
    expect([tank.x, tank.y, tank.health]).toEqual([2, 3, 3]);
  });

  test('allows movement through a destroyed wall', () => {
    const engine = new BattleEngine(8, 8);
    const tank = addTank(engine, 1, 3, 3);
    const wall = addWall(engine, 4, 3);
    wall.takeDamage(10);
    engine.resolveTick({ 1: 'moveRight' });
    expect([tank.x, tank.y, tank.health]).toEqual([4, 3, 3]);
  });

  test.each([false, true])('propagates a wall block through simultaneous movement chains (reverse: %s)', reverse => {
    const engine = new BattleEngine(8, 8);
    const tanks = [1, 2, 3].map((x, index) => new Tank(index + 1, 'Follower', x, 2, ''));
    for (const tank of reverse ? [...tanks].reverse() : tanks) engine.addTank(tank);
    addWall(engine, 4, 2);
    engine.resolveTick({ 1: 'moveRight', 2: 'moveRight', 3: 'moveRight' });
    expect(tanks.map(tank => [tank.x, tank.health])).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  test('allows a whole movement chain after the wall is destroyed', () => {
    const engine = new BattleEngine(8, 8);
    const tanks = [1, 2, 3].map((x, index) => addTank(engine, index + 1, x, 2));
    const wall = addWall(engine, 4, 2, 1);
    engine.arena.addBullet(new Bullet(20, 99, 4.5, 2, 180));
    engine.resolveTick({ 1: 'moveRight', 2: 'moveRight', 3: 'moveRight' });
    expect(wall.isDestroyed()).toBe(true);
    expect(tanks.map(tank => [tank.x, tank.health])).toEqual([[2, 3], [3, 3], [4, 3]]);
  });

  test('preserves same-destination and swap blocking with walls present', () => {
    const engine = new BattleEngine(8, 8);
    const first = addTank(engine, 1, 1, 2);
    const second = addTank(engine, 2, 3, 2);
    addWall(engine, 6, 6);
    engine.resolveTick({ 1: 'moveRight', 2: 'moveLeft' });
    expect([first.x, second.x]).toEqual([1, 3]);
    second.x = 2;
    engine.resolveTick({ 1: 'moveRight', 2: 'moveLeft' });
    expect([first.x, second.x]).toEqual([1, 2]);
  });

  test.each([
    [0, 2, 'moveLeft'], [7, 2, 'moveRight'], [2, 0, 'moveUp'], [2, 5, 'moveDown'],
  ])('retains arena-edge damage in a battle with walls (%i, %i, %s)', (x, y, action) => {
    const engine = new BattleEngine(8, 6);
    const tank = addTank(engine, 1, x, y);
    addWall(engine, 4, 3);
    engine.resolveTick({ 1: action });
    expect([tank.x, tank.y, tank.health]).toEqual([x, y, 2]);
  });
});

describe('bullet and wall collisions', () => {
  test.each([
    [2.25, 3, 0], [3.75, 3, 180], [3, 2.25, 270], [3, 3.75, 90],
    [2.5, 3, 0], [3.5, 3, 180], [3, 2.5, 270], [3, 3.5, 90],
  ])('hits a wall across fractional positions from (%s, %s), rotation %i', (x, y, rotation) => {
    const engine = new BattleEngine(8, 8);
    const wall = addWall(engine, 3, 3);
    engine.arena.addBullet(new Bullet(20, 99, x, y, rotation));
    engine.resolveTick({});
    expect(wall.health).toBe(9);
    expect(engine.arena.bullets).toEqual([]);
  });

  test.each([
    [2, 3, 0], [4, 3, 180], [3, 2, 270], [3, 4, 90],
  ])('includes the wall face when the bullet arrives at its half-cell edge (%s, %s, %s)', (x, y, rotation) => {
    const engine = new BattleEngine(8, 8);
    const wall = addWall(engine, 3, 3);
    engine.arena.addBullet(new Bullet(20, 99, x, y, rotation));
    engine.resolveTick({});
    expect(wall.health).toBe(9);
    expect(engine.arena.bullets).toEqual([]);
  });

  test('does not let a bullet that starts inside a wall escape', () => {
    const engine = new BattleEngine(8, 8);
    const wall = addWall(engine, 3, 3);
    engine.arena.addBullet(new Bullet(20, 99, 3.25, 3, 0));
    engine.resolveTick({});
    expect(wall.health).toBe(9);
    expect(engine.arena.bullets).toEqual([]);
  });

  test.each([false, true])('hits only the first wall on a longer segment, before going out of bounds (reverse: %s)', reverse => {
    const engine = new BattleEngine(8, 8);
    const near = new Wall(3, 3);
    const far = new Wall(5, 3);
    for (const wall of reverse ? [far, near] : [near, far]) engine.arena.addWall(wall);
    const bullet = new Bullet(20, 99, 1, 3, 0);
    // Stress swept detection independently of the current half-cell speed.
    bullet.move = () => { bullet.x = 9; };
    engine.arena.addBullet(bullet);
    engine.resolveTick({});
    expect([near.health, far.health]).toEqual([9, 10]);
    expect(engine.arena.bullets).toEqual([]);
  });

  test.each([false, true])('shared wall edges have a stable hit independent of wall insertion order (%s)', reverse => {
    const engine = new BattleEngine(8, 8);
    const upper = new Wall(3, 2);
    const lower = new Wall(3, 3);
    for (const wall of reverse ? [lower, upper] : [upper, lower]) engine.arena.addWall(wall);
    engine.arena.addBullet(new Bullet(20, 99, 2, 2.5, 0));
    engine.resolveTick({});
    expect([upper.health, lower.health]).toEqual([9, 10]);
  });

  test('leaves bullets that miss the wall alone and lets bullets pass a destroyed wall', () => {
    const engine = new BattleEngine(8, 8);
    const wall = addWall(engine, 3, 3);
    engine.arena.addBullet(new Bullet(20, 99, 2.25, 3.5001, 0));
    engine.resolveTick({});
    expect(wall.health).toBe(10);
    expect(engine.arena.bullets[0].x).toBe(2.75);
    wall.takeDamage(10);
    engine.arena.addBullet(new Bullet(21, 99, 2.5, 3, 0));
    engine.resolveTick({});
    expect(engine.arena.bullets.find(bullet => bullet.id === 21)).toMatchObject({ x: 3, y: 3 });
  });

  test.each([false, true])('absorbs all simultaneous hits, including excess lethal hits, regardless of order (%s)', reverse => {
    const engine = new BattleEngine(8, 8);
    const wall = addWall(engine, 3, 3, 1);
    const behind = addWall(engine, 4, 3);
    const tanks = [new Tank(1, 'Owner', 0, 0, ''), new Tank(2, 'Target', 5, 3, '')];
    for (const tank of reverse ? [...tanks].reverse() : tanks) engine.addTank(tank);
    const bullets = [new Bullet(20, 1, 2, 3, 0), new Bullet(21, 2, 2.25, 3, 0)];
    for (const bullet of reverse ? [...bullets].reverse() : bullets) engine.arena.addBullet(bullet);
    engine.resolveTick({});
    expect([wall.health, behind.health]).toEqual([0, 10]);
    expect(engine.arena.bullets).toEqual([]);
    expect(tanks.map(tank => [tank.health, tank.killCount])).toEqual([[3, 0], [3, 0]]);
  });

  test('takes exactly ten default bullet hits to destroy a default wall', () => {
    const engine = new BattleEngine(8, 8);
    const wall = addWall(engine, 3, 3);
    for (let hit = 1; hit <= 10; hit++) {
      engine.arena.addBullet(new Bullet(20 + hit, 99, 2.5, 3, 0));
      engine.resolveTick({});
      expect(wall.health).toBe(10 - hit);
      expect(wall.isDestroyed()).toBe(hit === 10);
      expect(engine.arena.bullets).toEqual([]);
    }
    expect(engine.arena.isPositionOccupiedByWall(3, 3)).toBe(false);
  });

  test.each([
    [0, 0, 0.5, 0, 180], [7, 0, 6.5, 0, 0],
    [0, 5, 0, 4.5, 270], [7, 5, 7, 4.5, 270],
  ])('damages a manually placed corner wall (%i, %i)', (wallX, wallY, x, y, rotation) => {
    const engine = new BattleEngine(8, 6);
    const wall = addWall(engine, wallX, wallY);
    engine.arena.addBullet(new Bullet(20, 99, x, y, rotation));
    engine.resolveTick({});
    expect(wall.health).toBe(9);
    expect(engine.arena.bullets).toEqual([]);
  });

  test.each([1, 2])('applies bullet damage before resolving tank movement (wall health %i)', health => {
    const engine = new BattleEngine(8, 8);
    const tank = addTank(engine, 1, 2, 2);
    const wall = addWall(engine, 3, 2, health);
    engine.arena.addBullet(new Bullet(20, 99, 3, 2.5, 90));
    engine.resolveTick({ 1: 'moveRight' });
    expect(wall.health).toBe(health - 1);
    expect([tank.x, tank.y, tank.health]).toEqual([health === 1 ? 3 : 2, 2, 3]);
    expect(engine.arena.bullets).toEqual([]);
  });

  test('preserves newly fired bullet timing next to a wall', () => {
    const engine = new BattleEngine(8, 8);
    const shooter = addTank(engine, 1, 2, 2);
    const wall = addWall(engine, 3, 2);
    engine.resolveTick({ 1: 'shoot' });
    expect(wall.health).toBe(10);
    expect(engine.arena.bullets[0]).toMatchObject({ x: 2.5, y: 2 });
    engine.resolveTick({});
    expect(wall.health).toBe(9);
    expect(shooter.health).toBe(3);
    expect(engine.arena.bullets).toEqual([]);
  });

  test('a wall-blocked tank still takes a bullet hit without extra impact damage', () => {
    const engine = new BattleEngine(8, 8);
    const tank = addTank(engine, 1, 3, 3);
    addWall(engine, 4, 3);
    engine.arena.addBullet(new Bullet(20, 99, 3, 3.5, 90));
    engine.resolveTick({ 1: 'moveRight' });
    expect([tank.x, tank.y, tank.health]).toEqual([3, 3, 2]);
  });

  test('preserves simultaneous tank hits and shared kill credit alongside wall hits', () => {
    const engine = new BattleEngine(8, 8);
    const owner = addTank(engine, 1, 0, 0);
    const secondOwner = addTank(engine, 2, 7, 7);
    const target = addTank(engine, 3, 5, 2, 1);
    const wall = addWall(engine, 3, 3);
    engine.arena.addBullet(new Bullet(20, 1, 4.5, 2, 0));
    engine.arena.addBullet(new Bullet(21, 2, 5.5, 2, 180));
    engine.arena.addBullet(new Bullet(22, 1, 2.5, 3, 0));
    engine.resolveTick({});
    expect([owner.killCount, secondOwner.killCount, target.health, wall.health]).toEqual([1, 1, 0, 9]);
    expect(engine.getLastTickEvents()).toEqual([{ type: 'tank-destroyed', x: 5, y: 2 }]);
    expect(engine.arena.bullets).toEqual([]);
  });

  test('retains the existing tank-damage-only stalemate rule', () => {
    const engine = new BattleEngine(8, 8);
    addTank(engine, 1, 0, 0);
    addTank(engine, 2, 7, 7);
    const wall = addWall(engine, 3, 3);
    for (let tick = 0; tick < 124; tick++) expect(engine.resolveTick({})).toBeNull();
    engine.arena.addBullet(new Bullet(20, 99, 2.5, 3, 0));
    expect(engine.resolveTick({})).toMatchObject({ reason: 'stalemate', tickCount: 125 });
    expect(wall.health).toBe(9);
  });
});

describe('wall-free compatibility', () => {
  test('matches the same whole battle with default, disabled and destroyed-only walls', () => {
    const engines = [new BattleEngine(8, 8), new BattleEngine(8, 8, false), new BattleEngine(8, 8)];
    for (const engine of engines) {
      addTank(engine, 1, 2, 2);
      const other = addTank(engine, 2, 5, 2);
      other.rotation = 180;
    }
    addWall(engines[2], 3, 2, 0);
    for (let tick = 0; tick < 8; tick++) {
      const commands = { 1: tick < 3 ? 'shoot' : 'moveUp', 2: 'shoot' };
      const results = engines.map(engine => engine.resolveTick(commands));
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
      for (const engine of engines.slice(1)) {
        expect(engine.getTankScriptStates()).toEqual(engines[0].getTankScriptStates());
        expect(engine.arena.bullets).toEqual(engines[0].arena.bullets);
        expect(engine.getLastTickEvents()).toEqual(engines[0].getLastTickEvents());
      }
    }
  });

  test('exposes plain living wall information without exposing the engine array', () => {
    const engine = new BattleEngine(8, 8);
    addTank(engine, 1, 2, 2);
    addWall(engine, 3, 3);
    expect(engine.getTankScriptStates()[0]).not.toHaveProperty('walls');
    expect(engine.getTankScriptStates()[0].allWalls).toEqual([{ x: 3, y: 3, health: 10, maxHealth: 10 }]);
    expect(engine.getTankScriptStates()[0].allWalls).not.toBe(engine.arena.walls);
  });
});
