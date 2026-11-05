import { afterEach, describe, expect, test } from '@jest/globals';
import { BattleEngine } from '../../../src/game/engine/battleEngine.js';
import { Bullet } from '../../../src/game/engine/bullet.js';
import { Tank } from '../../../src/game/engine/tank.js';

const originalStalemateTicks = BattleEngine.MAX_NO_PROGRESS_TICKS;

function addStillTank(engine, id, x, y, health = 3) {
  const tank = new Tank(id, `Tank ${id}`, x, y, '', health);
  engine.addTank(tank);
  return tank;
}

function addTwoStillTanks(engine) {
  addStillTank(engine, 1, 0, 0);
  addStillTank(engine, 2, 7, 7);
}

afterEach(() => {
  BattleEngine.MAX_NO_PROGRESS_TICKS = originalStalemateTicks;
});

describe('BattleEngine battle results', () => {
  test('declares a sole survivor the winner', () => {
    const engine = new BattleEngine(5, 5);
    const lastTank = addStillTank(engine, 1, 2, 2);

    expect(engine.tick()).toMatchObject({
      status: 'win',
      winner: lastTank,
      reason: 'elimination',
      tickCount: 1,
    });
  });

  test('returns mutual destruction when every tank is destroyed simultaneously', () => {
    const engine = new BattleEngine(8, 8);
    const first = addStillTank(engine, 1, 2, 2, 1);
    const second = addStillTank(engine, 2, 4, 2, 1);
    engine.arena.addBullet(new Bullet(1, first.id, 3.5, 2, 0));
    engine.arena.addBullet(new Bullet(2, second.id, 2.5, 2, 180));

    expect(engine.tick()).toMatchObject({
      status: 'tie',
      winner: null,
      reason: 'mutual-destruction',
      tickCount: 1,
    });
  });

  test('ends an undamaged battle in a stalemate after 125 ticks', () => {
    const engine = new BattleEngine(8, 8);
    addTwoStillTanks(engine);

    for (let tick = 0; tick < 124; tick += 1) expect(engine.tick()).toBeNull();
    expect(engine.tick()).toMatchObject({
      status: 'tie',
      winner: null,
      reason: 'stalemate',
      tickCount: 125,
    });
  });

  test('resets the no-progress counter when a tank takes damage', () => {
    const engine = new BattleEngine(8, 8);
    const owner = addStillTank(engine, 1, 0, 0);
    addStillTank(engine, 2, 3, 2);
    engine.arena.addBullet(new Bullet(1, owner.id, 2.5, 2, 0));

    expect(engine.tick()).toBeNull();
    for (let tick = 0; tick < 124; tick += 1) expect(engine.tick()).toBeNull();
    expect(engine.tick()).toMatchObject({ reason: 'stalemate', tickCount: 126 });
  });

  test('uses a unique surviving kill leader for stalemate victories', () => {
    const engine = new BattleEngine(8, 8);
    const leader = addStillTank(engine, 1, 0, 0);
    addStillTank(engine, 2, 7, 7);
    leader.addKill();

    for (let tick = 0; tick < 124; tick += 1) expect(engine.tick()).toBeNull();
    expect(engine.tick()).toMatchObject({ status: 'win', winner: leader, reason: 'stalemate' });
  });

  test('ties when multiple surviving tanks share the kill lead', () => {
    const engine = new BattleEngine(8, 8);
    const first = addStillTank(engine, 1, 0, 0);
    const second = addStillTank(engine, 2, 7, 7);
    first.addKill();
    second.addKill();

    for (let tick = 0; tick < 124; tick += 1) expect(engine.tick()).toBeNull();
    expect(engine.tick()).toMatchObject({ status: 'tie', winner: null, reason: 'stalemate' });
  });

  test('stops at the 1,000 tick maximum when stalemate is deferred', () => {
    BattleEngine.MAX_NO_PROGRESS_TICKS = 1001;
    const engine = new BattleEngine(8, 8);
    addTwoStillTanks(engine);

    let result;
    for (let tick = 0; tick < BattleEngine.MAX_TICKS; tick += 1) {
      result = engine.tick();
    }

    expect(result).toMatchObject({ status: 'tie', winner: null, reason: 'timeout', tickCount: 1000 });
  });
});
