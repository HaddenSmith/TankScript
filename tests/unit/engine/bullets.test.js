import { describe, expect, test } from '@jest/globals';
import { BattleEngine } from '../../../shared/game/engine/battleEngine.js';
import { Bullet } from '../../../shared/game/engine/bullet.js';
import { Tank } from '../../../shared/game/engine/tank.js';

function tank(id, x, y, health = 3) {
  return new Tank(id, `Tank ${id}`, x, y, '', health);
}

describe('BattleEngine bullets', () => {
  test('moves bullets by half a cell and leaves newly fired bullets at the muzzle until next tick', () => {
    const engine = new BattleEngine(8, 8);
    const shooter = tank(1, 2, 2);
    engine.addTank(shooter);
    shooter.code = 'shoot();';

    engine.tick();
    expect(engine.arena.bullets[0]).toMatchObject({ x: 2.5, y: 2, rotation: 0 });

    shooter.code = '';
    engine.tick();
    expect(engine.arena.bullets[0]).toMatchObject({ x: 3, y: 2 });
  });

  test('a newly fired bullet does not cancel an existing bullet at the muzzle', () => {
    const engine = new BattleEngine(8, 8);
    const shooter = tank(1, 2, 2);
    shooter.code = 'shoot();';
    engine.addTank(shooter);
    engine.addTank(tank(2, 7, 7));
    engine.arena.addBullet(new Bullet(20, 2, 3, 2, 180));

    engine.tick();

    expect(engine.arena.bullets).toHaveLength(2);
    expect(engine.arena.bullets.every(bullet => bullet.x === 2.5 && bullet.y === 2)).toBe(true);
    expect(engine.getLastTickEvents()).toEqual([]);

    shooter.code = '';
    engine.tick();

    expect(shooter.health).toBe(2);
    expect(engine.arena.bullets).toHaveLength(1);
    expect(engine.arena.bullets[0]).toMatchObject({ ownerId: 1, x: 3, y: 2 });
  });

  test('adjacent simultaneous shots survive their shared muzzle cell and hit next tick', () => {
    const engine = new BattleEngine(8, 8);
    const first = tank(1, 2, 2);
    const second = tank(2, 3, 2);
    first.code = 'shoot();';
    second.code = 'shoot();';
    second.rotation = 180;
    engine.addTank(first);
    engine.addTank(second);

    engine.tick();

    expect([first.health, second.health]).toEqual([3, 3]);
    expect(engine.arena.bullets).toHaveLength(2);
    expect(engine.arena.bullets.every(bullet => bullet.x === 2.5 && bullet.y === 2)).toBe(true);
    expect(engine.getLastTickEvents()).toEqual([]);

    first.code = '';
    second.code = '';
    engine.tick();

    expect([first.health, second.health]).toEqual([2, 2]);
    expect(engine.arena.bullets).toHaveLength(0);
  });

  test('damages a tank when a bullet reaches its cell and credits its owner', () => {
    const engine = new BattleEngine(8, 8);
    const owner = tank(1, 0, 0);
    const target = tank(2, 3, 2);
    engine.addTank(owner);
    engine.addTank(target);
    engine.arena.addBullet(new Bullet(1, owner.id, 2.5, 2, 0));

    engine.tick();

    expect(target.health).toBe(2);
    expect(engine.arena.bullets).toHaveLength(0);
  });

  test('allows a user-authored tank to cross a bullet path and take damage', () => {
    const engine = new BattleEngine(8, 8);
    const owner = tank(1, 0, 0);
    const target = tank(2, 2, 2);
    target.code = 'moveRight();';
    engine.addTank(owner);
    engine.addTank(target);
    engine.arena.addBullet(new Bullet(1, owner.id, 3, 2, 180));

    engine.tick();

    expect([target.x, target.y]).toEqual([3, 2]);
    expect(target.health).toBe(2);
    expect(engine.arena.bullets).toHaveLength(0);
  });

  test('damages a tank when a bullet crosses its movement path', () => {
    const engine = new BattleEngine(8, 8);
    const owner = tank(1, 0, 0);
    const target = tank(2, 2, 2);
    target.code = 'moveRight();';
    engine.addTank(owner);
    engine.addTank(target);
    engine.arena.addBullet(new Bullet(1, owner.id, 3, 2, 180));

    engine.tick();

    expect([target.x, target.y]).toEqual([3, 2]);
    expect(target.health).toBe(2);
    expect(engine.arena.bullets).toHaveLength(0);
  });

  test('damages a moving tank when a bullet reaches its previous cell', () => {
    const engine = new BattleEngine(8, 8);
    const owner = tank(1, 0, 0);
    const target = tank(2, 2, 2);
    target.code = 'moveRight();';
    engine.addTank(owner);
    engine.addTank(target);
    engine.arena.addBullet(new Bullet(1, owner.id, 1.5, 2, 0));

    engine.tick();

    expect([target.x, target.y]).toEqual([3, 2]);
    expect(target.health).toBe(2);
    expect(engine.arena.bullets).toHaveLength(0);
  });

  test('removes bullets that travel outside the arena', () => {
    const engine = new BattleEngine(4, 4);
    engine.addTank(tank(1, 1, 1));
    engine.addTank(tank(2, 3, 3));
    engine.arena.addBullet(new Bullet(1, 1, 3.5, 1, 0));

    engine.tick();

    expect(engine.arena.bullets).toHaveLength(0);
  });

  test('removes colliding bullets and emits one impact event', () => {
    const engine = new BattleEngine(8, 8);
    engine.addTank(tank(1, 0, 0));
    engine.addTank(tank(2, 7, 7));
    engine.arena.addBullet(new Bullet(1, 1, 2.5, 3, 0));
    engine.arena.addBullet(new Bullet(2, 2, 3.5, 3, 180));

    engine.tick();

    expect(engine.arena.bullets).toHaveLength(0);
    expect(engine.getLastTickEvents()).toEqual([{ type: 'bullet-impact', x: 3, y: 3 }]);
  });

  test('shares simultaneous kill credit and reports destruction once', () => {
    const engine = new BattleEngine(8, 8);
    const firstOwner = tank(1, 0, 0);
    const secondOwner = tank(2, 7, 7);
    const target = tank(3, 4, 3, 1);
    engine.addTank(firstOwner);
    engine.addTank(secondOwner);
    engine.addTank(target);
    engine.arena.addBullet(new Bullet(1, 1, 3.5, 3, 0));
    engine.arena.addBullet(new Bullet(2, 2, 4.5, 3, 180));

    engine.tick();

    expect(target.health).toBe(0);
    expect([firstOwner.killCount, secondOwner.killCount]).toEqual([1, 1]);
    expect(engine.getLastTickEvents().filter((event) => event.type === 'tank-destroyed')).toHaveLength(1);
  });

  test('tank impacts take priority over bullet-to-bullet impacts', () => {
    const engine = new BattleEngine(8, 8);
    engine.addTank(tank(1, 0, 0));
    engine.addTank(tank(2, 4, 3));
    engine.addTank(tank(3, 7, 7));
    engine.arena.addBullet(new Bullet(1, 1, 3.5, 3, 0));
    engine.arena.addBullet(new Bullet(2, 3, 4.5, 3, 180));

    engine.tick();

    expect(engine.arena.getTankById(2).health).toBe(1);
    expect(engine.getLastTickEvents()).toEqual([]);
  });
});
