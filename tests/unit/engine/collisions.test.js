import { describe, expect, test } from '@jest/globals';
import { BattleEngine } from '../../../shared/game/engine/battleEngine.js';
import { Tank } from '../../../shared/game/engine/tank.js';
import { Bullet } from '../../../shared/game/engine/bullet.js';

function addTank(engine, id, x, y, code = '', health = 3) {
  const tank = new Tank(id, `Tank ${id}`, x, y, code, health);
  engine.addTank(tank);
  return tank;
}

describe('boundary and simultaneous collisions', () => {
  test.each([
    [0, 2, 'moveLeft'], [4, 2, 'moveRight'],
    [2, 0, 'moveUp'], [2, 3, 'moveDown'],
    [0, 0, 'moveUp'], [4, 3, 'moveRight'],
  ])('blocks and damages a wall attempt at (%i, %i): %s', (x, y, action) => {
    const engine = new BattleEngine(5, 4);
    const tank = addTank(engine, 1, x, y, `${action}();`);
    addTank(engine, 2, 2, 2);
    engine.tick();
    expect([tank.x, tank.y, tank.health]).toEqual([x, y, 2]);
    expect(engine.getLastTickEvents()).toEqual([]);
  });

  test('repeated wall damage eliminates once, stops at zero and awards no kills', () => {
    const engine = new BattleEngine(5, 5);
    const tank = addTank(engine, 1, 0, 0, 'moveLeft();');
    const other = addTank(engine, 2, 4, 4);
    engine.tick();
    engine.tick();
    expect(engine.tick()).toMatchObject({ status: 'win', winner: other, reason: 'elimination' });
    expect(tank.health).toBe(0);
    expect(engine.getLastTickEvents()).toEqual([{ type: 'tank-destroyed', x: 0, y: 0 }]);
    engine.tick();
    expect(tank.health).toBe(0);
    expect(engine.getLastTickEvents()).toEqual([]);
    expect(other.killCount).toBe(0);
  });

  test('wall damage resets the no-progress counter', () => {
    const engine = new BattleEngine(5, 5);
    const tank = addTank(engine, 1, 0, 0);
    addTank(engine, 2, 4, 4);
    for (let tick = 0; tick < 124; tick++) expect(engine.tick()).toBeNull();
    tank.code = 'moveLeft();';
    expect(engine.tick()).toBeNull();
    tank.code = '';
    for (let tick = 0; tick < 124; tick++) expect(engine.tick()).toBeNull();
    expect(engine.tick()).toMatchObject({ reason: 'stalemate', tickCount: 250 });
  });

  test('a wall-blocked movement chain stays separated; only the wall attempt causes damage', () => {
    const engine = new BattleEngine(5, 5);
    const tanks = [0, 1, 2].map((x, i) => addTank(engine, i + 1, x, 2, 'moveLeft();'));
    engine.tick();
    expect(tanks.map(tank => tank.x)).toEqual([0, 1, 2]);
    expect(tanks.map(tank => tank.health)).toEqual([2, 3, 3]);
  });

  test.each([0, 3])('stationary tanks and wrecks block movement without wall damage (health %i)', health => {
    const engine = new BattleEngine(5, 5);
    const mover = addTank(engine, 1, 1, 2, 'moveRight();');
    addTank(engine, 2, 2, 2, '', health);
    engine.tick();
    expect([mover.x, mover.health]).toEqual([1, 3]);
  });

  test('a blocked tank still takes a bullet hit, without health going below zero', () => {
    const engine = new BattleEngine(5, 5);
    const tank = addTank(engine, 1, 0, 2, 'moveLeft();', 2);
    const owner = addTank(engine, 2, 4, 4);
    engine.arena.addBullet(new Bullet(20, owner.id, 0.5, 2, 180));
    engine.tick();
    expect([tank.x, tank.y, tank.health]).toEqual([0, 2, 0]);
    expect(owner.killCount).toBe(1);
    expect(engine.arena.bullets).toHaveLength(0);
    expect(engine.getLastTickEvents()).toHaveLength(1);
  });

  test.each([
    ['moveRight', 3, 2, 180], ['moveLeft', 1, 2, 0],
    ['moveUp', 2, 1, 270], ['moveDown', 2, 3, 90],
  ])('hits a tank sweeping across a half-cell bullet with %s', (action, x, y, rotation) => {
    const engine = new BattleEngine(5, 5);
    const mover = addTank(engine, 1, 2, 2, `${action}();`);
    addTank(engine, 2, 4, 4);
    // Own bullets have exactly the same collision rules.
    engine.arena.addBullet(new Bullet(20, mover.id, x, y, rotation));
    engine.tick();
    expect(mover.health).toBe(2);
    expect(engine.arena.bullets).toHaveLength(0);
  });

  test('a perpendicular escape works before a bullet reaches the original cell', () => {
    const engine = new BattleEngine(5, 5);
    const mover = addTank(engine, 1, 2, 2, 'moveUp();');
    addTank(engine, 2, 4, 4);
    engine.arena.addBullet(new Bullet(20, 2, 3, 2, 180));
    engine.tick();
    expect([mover.x, mover.y, mover.health]).toEqual([2, 1, 3]);
    expect(engine.arena.bullets).toHaveLength(1);
  });

  test.each([
    ['moveRight', 2, 2.5, 0], ['moveLeft', 2, 1.5, 180],
    ['moveUp', 2.5, 2, 90], ['moveDown', 1.5, 2, 270],
  ])('a nearby bullet outside the movement path does not hit during %s', (action, x, y, rotation) => {
    const engine = new BattleEngine(5, 5);
    const mover = addTank(engine, 1, 2, 2, `${action}();`);
    addTank(engine, 2, 4, 4);
    engine.arena.addBullet(new Bullet(20, 2, x, y, rotation));

    engine.tick();

    expect(mover.health).toBe(3);
    expect([mover.x, mover.y]).not.toEqual([2, 2]);
    expect(engine.arena.bullets).toHaveLength(1);
  });

  test.each([false, true])('a bullet arriving at a vacated cell hits its original occupant, regardless of insertion order (%s)', reverse => {
    const engine = new BattleEngine(6, 6);
    const departing = new Tank(1, 'Departing', 2, 2, 'moveRight();');
    const following = new Tank(2, 'Following', 1, 2, 'moveRight();');
    (reverse ? [following, departing] : [departing, following]).forEach(tank => engine.addTank(tank));
    engine.arena.addBullet(new Bullet(20, 99, 2, 1.5, 270));
    engine.tick();
    expect([departing.x, following.x]).toEqual([3, 2]);
    expect([departing.health, following.health]).toEqual([2, 3]);
    expect(engine.arena.bullets).toHaveLength(0);
  });

  test('simultaneous crossing hits destroy both tanks and credit both shooters', () => {
    const engine = new BattleEngine(6, 6);
    const a = addTank(engine, 1, 1, 2, 'moveRight();', 1);
    const b = addTank(engine, 2, 4, 2, 'moveLeft();', 1);
    engine.arena.addBullet(new Bullet(20, b.id, 2, 2, 180));
    engine.arena.addBullet(new Bullet(21, a.id, 3, 2, 0));
    expect(engine.tick()).toMatchObject({ reason: 'mutual-destruction' });
    expect([a.health, b.health, a.killCount, b.killCount]).toEqual([0, 0, 1, 1]);
    expect(engine.getLastTickEvents()).toHaveLength(2);
  });

  test('mutual wall deaths tie without kill credit', () => {
    const engine = new BattleEngine(5, 5);
    const a = addTank(engine, 1, 0, 1, 'moveLeft();', 1);
    const b = addTank(engine, 2, 4, 3, 'moveRight();', 1);
    expect(engine.tick()).toMatchObject({ reason: 'mutual-destruction', winner: null });
    expect([a.health, b.health, a.killCount, b.killCount]).toEqual([0, 0, 0, 0]);
    expect(engine.getLastTickEvents()).toHaveLength(2);
  });

  test('a shot hits a tank whose attempted escape is blocked by another tank', () => {
    const engine = new BattleEngine(6, 6);
    const mover = addTank(engine, 1, 2, 2, 'moveUp();');
    addTank(engine, 2, 2, 1);
    engine.arena.addBullet(new Bullet(20, 2, 2.5, 2, 180));
    engine.tick();
    expect([mover.x, mover.y, mover.health]).toEqual([2, 2, 2]);
    expect(engine.arena.bullets).toHaveLength(0);
  });

  test.each(['moveUp', 'moveDown', 'moveLeft', 'moveRight'])('a one-cell-wide arena blocks %s at its edge', action => {
    const engine = new BattleEngine(1, 1);
    const tank = addTank(engine, 1, 0, 0, `${action}();`, 1);
    expect(engine.tick()).toMatchObject({ reason: 'mutual-destruction' });
    expect([tank.x, tank.y, tank.health]).toEqual([0, 0, 0]);
  });
});
