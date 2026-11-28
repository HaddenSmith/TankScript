import { describe, expect, test } from '@jest/globals';
import { BattleEngine } from '../../../frontend/src/game/engine/battleEngine.js';
import { Bullet } from '../../../frontend/src/game/engine/bullet.js';
import { Heart } from '../../../frontend/src/game/engine/heart.js';
import { Lightning } from '../../../frontend/src/game/engine/lightning.js';
import { Tank } from '../../../frontend/src/game/engine/tank.js';
import { Wall } from '../../../frontend/src/game/engine/wall.js';

function addTank(engine, id, x, y, health = 3) {
  const tank = new Tank(id, `Tank ${id}`, x, y, '', health);
  engine.addTank(tank);
  return tank;
}

function hit(engine, id, ownerId, x = 4, y = 3) {
  engine.arena.addBullet(new Bullet(id, ownerId, x - 0.5, y, 0));
}

describe('successful tank-hit statistics', () => {
  test('starts at zero and supports adding several hits', () => {
    const tank = new Tank(1, 'Tank', 0, 0, '');
    expect(tank.damageDealt).toBe(0);
    tank.addDamageDealt();
    tank.addDamageDealt(3);
    expect(tank.damageDealt).toBe(4);
  });

  test('damages only the victim and credits only the owner of the hitting bullet', () => {
    const engine = new BattleEngine(8, 8);
    const owner = addTank(engine, 1, 0, 0);
    const bystander = addTank(engine, 2, 7, 7);
    const target = addTank(engine, 3, 4, 3);
    hit(engine, 20, owner.id);
    engine.resolveTick({});
    expect([owner.health, bystander.health, target.health]).toEqual([3, 3, 2]);
    expect([owner.damageDealt, bystander.damageDealt, target.damageDealt]).toEqual([1, 0, 0]);
    expect([owner.killCount, bystander.killCount, target.killCount]).toEqual([0, 0, 0]);
    expect(engine.arena.bullets).toEqual([]);
  });

  test('counts every hit by one owner without awarding a kill on a surviving target', () => {
    const engine = new BattleEngine(8, 8);
    const owner = addTank(engine, 1, 0, 0);
    const target = addTank(engine, 2, 4, 3, 5);
    for (let id = 20; id < 23; id++) hit(engine, id, owner.id);
    engine.resolveTick({});
    expect([target.health, owner.damageDealt, owner.killCount]).toEqual([2, 3, 0]);
  });

  test.each([false, true])('keeps each attacker’s nonlethal hit count separate (reverse %s)', reverse => {
    const engine = new BattleEngine(8, 8);
    const first = new Tank(1, 'First', 0, 0, '');
    const second = new Tank(2, 'Second', 7, 7, '');
    const target = new Tank(3, 'Target', 4, 3, '', 5);
    for (const tank of reverse ? [target, second, first] : [first, second, target]) engine.addTank(tank);
    const owners = reverse ? [second.id, first.id, first.id] : [first.id, first.id, second.id];
    owners.forEach((owner, index) => hit(engine, 20 + index, owner));
    engine.resolveTick({});
    expect([first.damageDealt, second.damageDealt, target.damageDealt, target.health]).toEqual([2, 1, 0, 2]);
    expect([first.killCount, second.killCount]).toEqual([0, 0]);
  });

  test.each([false, true])('credits overkill hits per owner and shares one kill per owner (reverse %s)', reverse => {
    const engine = new BattleEngine(8, 8);
    const first = new Tank(1, 'First', 0, 0, '');
    const second = new Tank(2, 'Second', 7, 7, '');
    const third = new Tank(3, 'Third', 0, 7, '');
    const target = new Tank(4, 'Target', 4, 3, '', 1);
    const tanks = [first, second, third, target];
    for (const tank of reverse ? [...tanks].reverse() : tanks) engine.addTank(tank);
    const owners = reverse ? [3, 2, 1, 1] : [1, 1, 2, 3];
    owners.forEach((owner, index) => hit(engine, 20 + index, owner));
    engine.resolveTick({});
    // These are successful hits, not HP removed: four hits against one remaining HP.
    expect([first.damageDealt, second.damageDealt, third.damageDealt]).toEqual([2, 1, 1]);
    expect([first.killCount, second.killCount, third.killCount]).toEqual([1, 1, 1]);
    expect(target.health).toBe(0);
    expect(engine.getLastTickEvents()).toEqual([{ type: 'tank-destroyed', x: 4, y: 3 }]);
    expect(engine.arena.bullets).toEqual([]);
    engine.resolveTick({});
    expect([first.damageDealt, second.damageDealt, third.damageDealt]).toEqual([2, 1, 1]);
    expect([first.killCount, second.killCount, third.killCount]).toEqual([1, 1, 1]);
    expect(engine.getLastTickEvents()).toEqual([]);
  });

  test('counts multiple victims independently without multiplying another owner’s hits', () => {
    const engine = new BattleEngine(8, 8);
    const first = addTank(engine, 1, 0, 0);
    const second = addTank(engine, 2, 7, 7);
    const targetA = addTank(engine, 3, 4, 3, 1);
    const targetB = addTank(engine, 4, 4, 4, 1);
    hit(engine, 20, first.id);
    hit(engine, 21, first.id);
    hit(engine, 22, second.id);
    hit(engine, 23, first.id, 4, 4);
    engine.resolveTick({});
    expect([first.damageDealt, first.killCount]).toEqual([3, 2]);
    expect([second.damageDealt, second.killCount]).toEqual([1, 1]);
    expect([targetA.health, targetB.health]).toEqual([0, 0]);
    expect(engine.getLastTickEvents()).toHaveLength(2);
  });

  test.each([false, true])('mutually destroyed owners retain credit for their simultaneous outgoing hits (%s)', reverse => {
    const engine = new BattleEngine(8, 8);
    const first = new Tank(1, 'First', 2, 3, '', 1);
    const second = new Tank(2, 'Second', 4, 3, '', 1);
    for (const tank of reverse ? [second, first] : [first, second]) engine.addTank(tank);
    hit(engine, 20, second.id, 2, 3);
    hit(engine, 21, first.id, 4, 3);
    expect(engine.resolveTick({})).toMatchObject({ reason: 'mutual-destruction' });
    expect([first.damageDealt, second.damageDealt, first.killCount, second.killCount]).toEqual([1, 1, 1, 1]);
  });

  test('handles missing owners and ignores shots through an already destroyed tank', () => {
    const engine = new BattleEngine(8, 8);
    const target = addTank(engine, 1, 4, 3, 1);
    hit(engine, 20, 99);
    expect(() => engine.resolveTick({})).not.toThrow();
    expect([target.health, target.damageDealt, target.killCount]).toEqual([0, 0, 0]);
    hit(engine, 21, 99);
    engine.resolveTick({});
    expect(target.health).toBe(0);
    expect(engine.getLastTickEvents()).toEqual([]);
    expect(engine.arena.bullets).toHaveLength(1);
  });

  test('a wall hit, a miss, an arena-edge impact and bullet collisions award no tank-hit credit', () => {
    const engine = new BattleEngine(8, 8);
    const first = addTank(engine, 1, 0, 0);
    const second = addTank(engine, 2, 7, 7);
    const wall = new Wall(4, 3);
    engine.arena.addWall(wall);
    hit(engine, 20, first.id);
    engine.arena.addBullet(new Bullet(21, first.id, 2.5, 5, 0));
    engine.arena.addBullet(new Bullet(22, second.id, 3.5, 5, 180));
    engine.arena.addBullet(new Bullet(23, first.id, 7.5, 4, 0));
    engine.resolveTick({ 1: 'moveLeft' });
    expect([first.health, wall.health]).toEqual([2, 9]);
    expect([first.damageDealt, second.damageDealt, first.killCount, second.killCount]).toEqual([0, 0, 0, 0]);
  });

  test('self-hits follow the existing owner-based attribution rule', () => {
    const engine = new BattleEngine(8, 8);
    const tank = addTank(engine, 1, 4, 3, 1);
    hit(engine, 20, tank.id);
    engine.resolveTick({});
    expect([tank.health, tank.damageDealt, tank.killCount]).toEqual([0, 1, 1]);
  });
});

describe('power-up-free regressions and scripting boundaries', () => {
  test('default and explicitly disabled battles produce identical states, statistics and events', () => {
    const engines = [new BattleEngine(8, 8), new BattleEngine(8, 8, false, false)];
    for (const engine of engines) {
      const first = addTank(engine, 1, 2, 2);
      const second = addTank(engine, 2, 5, 2);
      first.code = 'shoot();';
      second.code = 'shoot();';
      second.rotation = 180;
    }
    for (let tick = 0; tick < 8; tick++) {
      expect(engines[1].tick()).toEqual(engines[0].tick());
      expect(engines[1].arena).toEqual(engines[0].arena);
      expect(engines[1].getLastTickEvents()).toEqual(engines[0].getLastTickEvents());
    }
  });

  test('exposes arena and ability data while keeping engine statistics private', () => {
    const engine = new BattleEngine(8, 8, false, true);
    const tank = addTank(engine, 1, 1, 2);
    engine.arena.addHeart(new Heart(2, 2));
    engine.arena.addLightning(new Lightning(3, 2));
    tank.lightningPowerup(true);
    engine.resolveTick({ 1: 'shoot' });
    const state = engine.getTankScriptStates()[0];
    expect(Object.keys(state).sort()).toEqual([
      'allBullets', 'allTanks', 'arenaHeight', 'arenaWidth', 'tankHealth', 'tankId', 'tankPosition', 'tankRotation',
      'allWalls', 'allPowerups', 'tankMaxHealth', 'tankBulletSpeed', 'tankLightningTicksRemaining',
    ].sort());
    expect(Object.keys(state.allTanks[0]).sort()).toEqual(['health', 'id', 'name', 'rotation', 'x', 'y', 'maxHealth', 'bulletSpeed', 'lightningTicksRemaining'].sort());
    expect(Object.keys(state.allBullets[0]).sort()).toEqual(['id', 'ownerId', 'rotation', 'x', 'y', 'speed'].sort());
    expect(state.allTanks[0]).not.toHaveProperty('damageDealt');
    expect(state.allTanks[0]).not.toHaveProperty('killCount');
  });
});
