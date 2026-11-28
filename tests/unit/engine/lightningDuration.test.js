import { describe, expect, test } from '@jest/globals';
import { BattleEngine } from '../../../frontend/src/game/engine/battleEngine.js';
import { Bullet } from '../../../frontend/src/game/engine/bullet.js';
import { Lightning } from '../../../frontend/src/game/engine/lightning.js';
import { Tank } from '../../../frontend/src/game/engine/tank.js';
import { createBattleStateSnapshot } from '../../../frontend/src/game/battleState.js';

function createScenario(health = 3) {
  const engine = new BattleEngine(128, 80, false, true);
  const tank = new Tank(1, 'Collector', 1, 2, '', health);
  engine.addTank(tank);
  engine.addTank(new Tank(2, 'Other', 127, 79, ''));
  engine.arena.addLightning(new Lightning(2, 2));
  return { engine, tank };
}

describe('temporary lightning', () => {
  test('starts inactive and boosts exactly the 30 ticks following a late collection', () => {
    const { engine, tank } = createScenario();
    tank.rotation = 270;
    const normalBullet = tank.shoot(90);
    engine.arena.addBullet(normalBullet);
    tank.rotation = 0;
    expect([tank.lightningTicksRemaining, tank.hasLightningPowerup, normalBullet.speed]).toEqual([0, false, 0.5]);
    for (let tick = 0; tick < 7; tick++) engine.resolveTick({});
    engine.resolveTick({ 1: 'moveRight' }); // Collect on tick N = 8.
    expect(engine.getTickCount()).toBe(8);
    expect([tank.lightningTicksRemaining, tank.hasLightningPowerup]).toEqual([30, true]);
    expect(engine.arena.lightnings).toEqual([]);

    for (let elapsed = 1; elapsed <= 30; elapsed++) {
      engine.resolveTick({ 1: 'shoot' });
      const shot = engine.arena.getBulletById(elapsed);
      expect(shot.speed).toBe(1);
      expect(shot.x).toBe(2.5); // Newly fired bullets still wait at the muzzle.
      expect(tank.lightningTicksRemaining).toBe(30 - elapsed);
      expect(tank.hasLightningPowerup).toBe(elapsed < 30);
      expect(normalBullet.speed).toBe(0.5);
    }

    expect(engine.getTickCount()).toBe(38); // N+30 fires the final boosted shot, then expires.
    const lastBoostedShot = engine.arena.getBulletById(30);
    const normalY = normalBullet.y;
    engine.resolveTick({ 1: 'shoot' });
    expect(engine.arena.getBulletById(31).speed).toBe(0.5);
    expect(lastBoostedShot).toMatchObject({ speed: 1, x: 3.5 });
    expect(normalBullet.y).toBe(normalY + 0.5);
    expect(engine.arena.getBulletById(90)).toBe(normalBullet);
    expect(engine.arena.getBulletById(30)).toBe(lastBoostedShot);
    expect(tank.lightningTicksRemaining).toBe(0);
    expect(engine.arena.lightnings).toEqual([]); // Expiration does not respawn pickups.
  });

  test.each([1, 17, 30])('recollection on boosted tick %i refreshes to 30 without stacking', elapsed => {
    const { engine, tank } = createScenario();
    engine.resolveTick({ 1: 'moveRight' });
    for (let tick = 1; tick < elapsed; tick++) engine.resolveTick({});
    expect(tank.lightningTicksRemaining).toBe(31 - elapsed);
    engine.arena.addLightning(new Lightning(3, 2));
    engine.resolveTick({ 1: 'moveRight' });
    expect([tank.lightningTicksRemaining, tank.hasLightningPowerup]).toEqual([30, true]);
    expect(engine.arena.lightnings).toEqual([]);
    for (let tick = 1; tick < 30; tick++) engine.resolveTick({});
    expect(tank.lightningTicksRemaining).toBe(1);
    engine.resolveTick({ 1: 'shoot' });
    expect(engine.arena.getBulletById(1).speed).toBe(1);
    expect([tank.lightningTicksRemaining, tank.hasLightningPowerup]).toEqual([0, false]);
    engine.resolveTick({ 1: 'shoot' });
    expect(engine.arena.getBulletById(2).speed).toBe(0.5);
  });

  test('an expired effect can be collected again without upgrading bullets fired during the gap', () => {
    const { engine, tank } = createScenario();
    engine.resolveTick({ 1: 'moveRight' });
    for (let tick = 0; tick < 30; tick++) engine.resolveTick({});
    engine.resolveTick({ 1: 'shoot' });
    const normalBullet = engine.arena.getBulletById(1);
    expect(normalBullet.speed).toBe(0.5);
    // Let the normal bullet clear the next pickup cell before placing lightning.
    engine.resolveTick({ 1: 'moveDown' });
    engine.resolveTick({ 1: 'moveRight' });
    engine.resolveTick({});
    engine.arena.addLightning(new Lightning(3, 2));
    engine.resolveTick({ 1: 'moveUp' });
    expect([tank.lightningTicksRemaining, tank.hasLightningPowerup]).toEqual([30, true]);
    expect(normalBullet.speed).toBe(0.5);
    expect(engine.arena.getBulletById(1)).toBe(normalBullet);
  });

  test.each(['bullet', 'boundary'])('clears a destroyed tank’s effect after %s damage and preserves outgoing bullet speed', cause => {
    const { engine, tank } = createScenario(1);
    engine.resolveTick({ 1: 'moveRight' });
    if (cause === 'bullet') {
      engine.arena.addBullet(new Bullet(90, 2, 2.5, 2, 180));
      engine.resolveTick({ 1: 'shoot' });
    } else {
      engine.resolveTick({ 1: 'moveLeft' });
      engine.resolveTick({ 1: 'moveLeft' });
      engine.arena.addBullet(tank.shoot(1));
      engine.resolveTick({ 1: 'moveLeft' });
    }
    expect(tank.health).toBe(0);
    expect([tank.lightningTicksRemaining, tank.hasLightningPowerup]).toEqual([0, false]);
    const shot = engine.arena.getBulletById(1);
    expect(shot.speed).toBe(1);
    const x = shot.x;
    engine.resolveTick({ 1: 'shoot' });
    expect(shot.x).toBe(x + 1);
    expect(engine.arena.bullets).toHaveLength(1);
    tank.lightningPowerup(true);
    expect(tank.lightningTicksRemaining).toBe(0);
  });

  test('only resolving game ticks consumes duration, and a new battle starts without an effect', () => {
    const { engine, tank } = createScenario();
    engine.resolveTick({ 1: 'moveRight' });
    for (let render = 0; render < 100; render++) {
      engine.getTankScriptStates();
      expect(createBattleStateSnapshot(engine, 3).arena.tanks[0].lightningTicksRemaining).toBe(30);
      expect(tank.shoot(90).speed).toBe(1);
    }
    expect(tank.lightningTicksRemaining).toBe(30);
    engine.resolveTick({});
    expect(tank.lightningTicksRemaining).toBe(29);
    const reset = createScenario();
    expect([reset.tank.lightningTicksRemaining, reset.tank.hasLightningPowerup]).toEqual([0, false]);
    expect(reset.tank.shoot(1).speed).toBe(0.5);
    expect(engine.getTankScriptStates()[0]).not.toHaveProperty('lightningTicksRemaining');
    expect(engine.getTankScriptStates()[0].allTanks[0].lightningTicksRemaining).toBe(29);
    expect(engine.getTankScriptStates()[0].tankLightningTicksRemaining).toBe(29);
  });
});
