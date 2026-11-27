import { describe, expect, test } from '@jest/globals';
import { BattleEngine } from '../../../frontend/src/game/engine/battleEngine.js';
import { Bullet } from '../../../frontend/src/game/engine/bullet.js';
import { Tank } from '../../../frontend/src/game/engine/tank.js';
import { Wall } from '../../../frontend/src/game/engine/wall.js';

function addTank(engine, id, x, y, health = 3) {
  const tank = new Tank(id, `Tank ${id}`, x, y, '', health);
  engine.addTank(tank);
  return tank;
}

describe('bullet speed at creation', () => {
  test.each([[0, 3.5, 3, 4.5, 3], [90, 3, 2.5, 3, 1.5], [180, 2.5, 3, 1.5, 3], [270, 3, 3.5, 3, 4.5]])(
    'preserves half-cell muzzle positions and uses the captured speed at rotation %i', (rotation, x, y, movedX, movedY) => {
      const tank = new Tank(1, 'Tank', 3, 3, '');
      tank.rotation = rotation;
      const normal = tank.shoot(1);
      tank.lightningPowerup(true);
      const fast = tank.shoot(2);
      tank.lightningPowerup(false);
      expect(normal).toMatchObject({ x, y, rotation, speed: 0.5 });
      expect(fast).toMatchObject({ x, y, rotation, speed: 1 });
      fast.move();
      expect([fast.x, fast.y]).toEqual([movedX, movedY]);
      expect(normal.speed).toBe(0.5);
    },
  );
});

describe('fast bullet tank collisions', () => {
  test.each([[0, 1.5, 3, 2, 3], [90, 3, 4.5, 3, 4], [180, 4.5, 3, 4, 3], [270, 3, 1.5, 3, 2]])(
    'hits a tank between fractional endpoints at rotation %i', (rotation, x, y, targetX, targetY) => {
      const engine = new BattleEngine(8, 8);
      const owner = addTank(engine, 1, 0, 0);
      const target = addTank(engine, 2, targetX, targetY);
      engine.arena.addBullet(new Bullet(20, owner.id, x, y, rotation, 1));
      engine.resolveTick({});
      expect(target.health).toBe(2);
      expect(owner.damageDealt).toBe(1);
      expect(engine.arena.bullets).toEqual([]);
    },
  );

  test.each([false, true])('hits the nearest tank only, independent of tank order (%s)', reverse => {
    const engine = new BattleEngine(8, 8);
    const near = new Tank(1, 'Near', 2, 3, '');
    const far = new Tank(2, 'Far', 3, 3, '');
    for (const tank of reverse ? [far, near] : [near, far]) engine.addTank(tank);
    engine.arena.addBullet(new Bullet(20, 99, 1.5, 3, 0, 2));
    engine.resolveTick({});
    expect([near.health, far.health]).toEqual([2, 3]);
  });

  test.each([false, true])('keeps original-occupant priority over a following tank (%s)', reverse => {
    const engine = new BattleEngine(8, 8);
    const departing = new Tank(1, 'Departing', 2, 2, '');
    const following = new Tank(2, 'Following', 1, 2, '');
    for (const tank of reverse ? [following, departing] : [departing, following]) engine.addTank(tank);
    engine.arena.addBullet(new Bullet(20, 99, 2, 1.5, 270, 1));
    engine.resolveTick({ 1: 'moveRight', 2: 'moveRight' });
    expect([departing.x, following.x]).toEqual([3, 2]);
    expect([departing.health, following.health]).toEqual([2, 3]);
  });

  test('hits perpendicular movement between both bullet and tank endpoints', () => {
    const engine = new BattleEngine(8, 8);
    const tank = addTank(engine, 1, 1, 2);
    engine.arena.addBullet(new Bullet(20, 99, 1.5, 1.5, 270, 1));
    engine.resolveTick({ 1: 'moveRight' });
    expect([tank.x, tank.y, tank.health]).toEqual([2, 2, 2]);
    expect(engine.arena.bullets).toEqual([]);
  });

  test.each([false, true])('selects the nearest of multiple moving paths consistently (%s)', reverse => {
    const engine = new BattleEngine(8, 8);
    const first = new Tank(1, 'First', 2, 1, '');
    const second = new Tank(2, 'Second', 3, 1, '');
    for (const tank of reverse ? [second, first] : [first, second]) engine.addTank(tank);
    engine.arena.addBullet(new Bullet(20, 99, 1.5, 2, 0, 2));
    engine.resolveTick({ 1: 'moveDown', 2: 'moveDown' });
    expect([first.health, second.health]).toEqual([2, 3]);
  });

  test('does not hit a nearby tank outside either path, or a destroyed tank', () => {
    const engine = new BattleEngine(8, 8);
    const nearby = addTank(engine, 1, 2, 2);
    addTank(engine, 2, 2, 3, 0);
    engine.arena.addBullet(new Bullet(20, 99, 1.5, 3, 0, 1));
    engine.resolveTick({ 1: 'moveUp' });
    expect(nearby.health).toBe(3);
    expect(engine.arena.bullets[0]).toMatchObject({ x: 2.5, y: 3 });
  });

  test('adjacent fast shots retain muzzle timing, simultaneous damage and shared credit', () => {
    const engine = new BattleEngine(8, 8);
    const first = addTank(engine, 1, 2, 2, 1);
    const second = addTank(engine, 2, 3, 2, 1);
    first.lightningPowerup(true);
    second.lightningPowerup(true);
    second.rotation = 180;
    engine.resolveTick({ 1: 'shoot', 2: 'shoot' });
    expect([first.health, second.health]).toEqual([1, 1]);
    expect(engine.arena.bullets).toHaveLength(2);
    expect(engine.arena.bullets.every(bullet => bullet.x === 2.5 && bullet.speed === 1)).toBe(true);
    expect(engine.resolveTick({})).toMatchObject({ reason: 'mutual-destruction' });
    expect([first.damageDealt, second.damageDealt, first.killCount, second.killCount]).toEqual([1, 1, 1, 1]);
    expect(engine.arena.bullets).toEqual([]);
  });
});

describe('fast bullets, walls and boundaries', () => {
  test.each([[0, 1.5, 3], [90, 3, 4.5], [180, 4.5, 3], [270, 3, 1.5]])(
    'cannot skip the wall face at rotation %i', (rotation, x, y) => {
      const engine = new BattleEngine(8, 8);
      const wall = new Wall(3, 3);
      engine.arena.addWall(wall);
      engine.arena.addBullet(new Bullet(20, 99, x, y, rotation, 2));
      engine.resolveTick({});
      expect(wall.health).toBe(9);
      expect(engine.arena.bullets).toEqual([]);
    },
  );

  test('a tank in front of a wall takes the hit; the wall does not', () => {
    const engine = new BattleEngine(8, 8);
    const target = addTank(engine, 1, 2, 3);
    const wall = new Wall(3, 3);
    engine.arena.addWall(wall);
    engine.arena.addBullet(new Bullet(20, 99, 1.5, 3, 0, 1));
    engine.resolveTick({});
    expect([target.health, wall.health]).toEqual([2, 10]);
  });

  test.each([false, true])('all simultaneous hits are absorbed by a shielding wall, even if lethal (%s)', reverse => {
    const engine = new BattleEngine(8, 8);
    const owner = addTank(engine, 1, 0, 0);
    const target = addTank(engine, 2, 3, 3);
    const wall = new Wall(2, 3, 1);
    engine.arena.addWall(wall);
    const bullets = [new Bullet(20, owner.id, 0.5, 3, 0, 3), new Bullet(21, owner.id, 1.5, 3, 0, 1)];
    for (const bullet of reverse ? [...bullets].reverse() : bullets) engine.arena.addBullet(bullet);
    engine.resolveTick({});
    expect([wall.health, target.health, owner.damageDealt, owner.killCount]).toEqual([0, 3, 0, 0]);
    expect(engine.arena.bullets).toEqual([]);
  });

  test('passes a destroyed wall and hits the target behind it', () => {
    const engine = new BattleEngine(8, 8);
    const target = addTank(engine, 1, 3, 3);
    engine.arena.addWall(new Wall(2, 3, 0));
    engine.arena.addBullet(new Bullet(20, 99, 1.5, 3, 0, 2));
    engine.resolveTick({});
    expect(target.health).toBe(2);
  });

  test.each([[0, 7.5, 3], [90, 3, -0.5], [180, -0.5, 3], [270, 3, 7.5]])(
    'removes a fast bullet leaving the arena at rotation %i', (rotation, x, y) => {
      const engine = new BattleEngine(8, 8);
      engine.arena.addBullet(new Bullet(20, 99, x, y, rotation, 1));
      engine.resolveTick({});
      expect(engine.arena.bullets).toEqual([]);
      expect(engine.getLastTickEvents()).toEqual([]);
    },
  );

  test('hits a moving tank at the arena edge before discarding the outgoing bullet', () => {
    const engine = new BattleEngine(4, 4);
    const tank = addTank(engine, 1, 3, 1);
    engine.arena.addBullet(new Bullet(20, 99, 2.5, 2, 0, 2));
    engine.resolveTick({ 1: 'moveDown' });
    expect([tank.x, tank.y, tank.health]).toEqual([3, 2, 2]);
    expect(engine.arena.bullets).toEqual([]);
  });

  test('keeps a bullet exactly on the half-cell arena boundary until it moves out', () => {
    const engine = new BattleEngine(4, 4);
    engine.arena.addBullet(new Bullet(20, 99, 2.5, 2, 0, 1));
    engine.resolveTick({});
    expect(engine.arena.bullets[0]).toMatchObject({ x: 3.5 });
    engine.resolveTick({});
    expect(engine.arena.bullets).toEqual([]);
  });
});

describe('fast bullet-to-bullet collisions', () => {
  test.each([false, true])('cancels head-on shots that cross without sharing endpoints (%s)', reverse => {
    const engine = new BattleEngine(8, 8);
    const bullets = [new Bullet(20, 99, 2.5, 3, 0, 1), new Bullet(21, 98, 3.5, 3, 180, 1)];
    for (const bullet of reverse ? [...bullets].reverse() : bullets) engine.arena.addBullet(bullet);
    engine.resolveTick({});
    expect(engine.arena.bullets).toEqual([]);
    expect(engine.getLastTickEvents()).toEqual([{ type: 'bullet-impact', x: 3, y: 3 }]);
  });

  test('cancels fast and normal bullets at their actual shared position', () => {
    const engine = new BattleEngine(8, 8);
    engine.arena.addBullet(new Bullet(20, 99, 2.5, 3, 0, 1));
    engine.arena.addBullet(new Bullet(21, 98, 3.5, 3, 180));
    engine.resolveTick({});
    expect(engine.arena.bullets).toEqual([]);
    expect(engine.getLastTickEvents()).toHaveLength(1);
    expect(engine.getLastTickEvents()[0].x).toBeCloseTo(19 / 6);
  });

  test('cancels perpendicular shots meeting at the same time', () => {
    const engine = new BattleEngine(8, 8);
    engine.arena.addBullet(new Bullet(20, 99, 2, 3, 0, 1));
    engine.arena.addBullet(new Bullet(21, 98, 2.5, 2.5, 270, 1));
    engine.resolveTick({});
    expect(engine.arena.bullets).toEqual([]);
    expect(engine.getLastTickEvents()).toEqual([{ type: 'bullet-impact', x: 2.5, y: 3 }]);
  });

  test('does not cancel paths crossing at different times, parallel shots, or diverging shared-muzzle shots', () => {
    const scenarios = [
      [new Bullet(20, 99, 2, 3, 0, 1), new Bullet(21, 98, 2.5, 2.5, 270)],
      [new Bullet(20, 99, 2, 3, 0, 1), new Bullet(21, 98, 3, 3, 0, 1)],
      [new Bullet(20, 99, 2.5, 3, 0, 1), new Bullet(21, 98, 2.5, 3, 180, 1)],
    ];
    for (const bullets of scenarios) {
      const engine = new BattleEngine(8, 8);
      for (const bullet of bullets) engine.arena.addBullet(bullet);
      engine.resolveTick({});
      expect(engine.arena.bullets).toHaveLength(2);
      expect(engine.getLastTickEvents()).toEqual([]);
    }
  });
});
