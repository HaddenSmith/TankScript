import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { Arena } from '../../../frontend/src/game/engine/arena.js';
import { BattleEngine } from '../../../frontend/src/game/engine/battleEngine.js';
import { Tank } from '../../../frontend/src/game/engine/tank.js';
import { Wall } from '../../../frontend/src/game/engine/wall.js';
import { Heart } from '../../../frontend/src/game/engine/heart.js';
import { Lightning } from '../../../frontend/src/game/engine/lightning.js';

afterEach(() => jest.restoreAllMocks());

function battle(enabled = true) {
  const engine = new BattleEngine(8, 8, false, enabled);
  engine.addTank(new Tank(1, 'First', 0, 7, '', 100));
  engine.addTank(new Tank(2, 'Second', 7, 7, '', 100));
  return engine;
}

function advanceTo(engine, count) {
  while (engine.getTickCount() < count) {
    // Real boundary damage keeps long scheduling scenarios below the stalemate limit.
    engine.resolveTick(engine.getTickCount() % 60 === 59 ? { 1: 'moveLeft' } : {});
  }
}

describe('periodic power-up spawning', () => {
  test('attempts once at completed-tick counts 0, 75, 150 and 225', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const engine = battle();
    const attempts = [];
    const spawn = engine.arena.spawnPowerups.bind(engine.arena);
    jest.spyOn(engine.arena, 'spawnPowerups').mockImplementation(() => {
      attempts.push(engine.getTickCount());
      spawn();
    });
    expect(engine.arena.hearts).toEqual([]);
    engine.resolveTick({});
    const heart = engine.arena.hearts[0];
    const lightning = engine.arena.lightnings[0];
    for (const count of [74, 75, 76, 149, 150, 151, 225, 226]) {
      advanceTo(engine, count);
      expect(attempts).toEqual([0, 75, 150, 225].filter(tick => tick < count));
      expect(engine.arena.hearts).toEqual([heart]);
      expect(engine.arena.lightnings).toEqual([lightning]);
      expect(engine.arena.hearts[0]).toBe(heart);
      expect(engine.arena.lightnings[0]).toBe(lightning);
    }
  });

  test.each([false, undefined])('does not automatically spawn when disabled (%s)', enabled => {
    const engine = battle(false);
    if (enabled === undefined) engine.powerupsEnabled = undefined;
    const spawn = jest.spyOn(engine.arena, 'spawnPowerups');
    advanceTo(engine, 226);
    expect(spawn).not.toHaveBeenCalled();
    expect(engine.arena.hearts).toEqual([]);
    expect(engine.arena.lightnings).toEqual([]);
  });

  test('replenishes missing types independently without moving or duplicating the other', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const engine = battle();
    engine.resolveTick({});
    const heart = engine.arena.hearts[0];
    engine.arena.removeLightning(engine.arena.lightnings[0]);
    advanceTo(engine, 75);
    expect(engine.arena.lightnings).toEqual([]);
    engine.resolveTick({});
    const lightning = engine.arena.lightnings[0];
    expect(engine.arena.hearts[0]).toBe(heart);
    expect(engine.arena.lightnings).toHaveLength(1);
    engine.arena.removeHeart(heart);
    advanceTo(engine, 150);
    expect(engine.arena.hearts).toEqual([]);
    engine.resolveTick({});
    expect(engine.arena.hearts).toHaveLength(1);
    expect(engine.arena.hearts[0]).not.toBe(heart);
    expect(engine.arena.lightnings).toEqual([lightning]);
    expect(engine.arena.lightnings[0]).toBe(lightning);
  });

  test('skips a missing type when full, then retries after a wall is destroyed', () => {
    const engine = new BattleEngine(2, 2, false, true);
    engine.addTank(new Tank(1, 'First', 0, 0, ''));
    engine.addTank(new Tank(2, 'Second', 1, 1, ''));
    const wall = new Wall(0, 1);
    engine.arena.addWall(wall);
    engine.resolveTick({});
    const heart = engine.arena.hearts[0];
    expect(heart).toEqual({ x: 1, y: 0 });
    expect(engine.arena.lightnings).toEqual([]);
    wall.takeDamage(10);
    advanceTo(engine, 75);
    expect(engine.arena.lightnings).toEqual([]);
    engine.resolveTick({});
    expect(engine.arena.hearts[0]).toBe(heart);
    expect(engine.arena.lightnings).toEqual([new Lightning(0, 1)]);
  });

  test('a completely full arena skips all scheduled attempts safely', () => {
    const engine = new BattleEngine(2, 1, false, true);
    engine.addTank(new Tank(1, 'First', 0, 0, '', 100));
    engine.addTank(new Tank(2, 'Second', 1, 0, '', 100));
    advanceTo(engine, 151);
    expect(engine.arena.hearts).toEqual([]);
    expect(engine.arena.lightnings).toEqual([]);
  });

  test('preserves multiple manually placed pickups and only fills an entirely missing type', () => {
    const arena = new Arena(8, 8);
    const hearts = [new Heart(1, 1), new Heart(2, 1)];
    const lightnings = [new Lightning(1, 2), new Lightning(2, 2)];
    hearts.forEach(heart => arena.addHeart(heart));
    lightnings.forEach(lightning => arena.addLightning(lightning));
    arena.spawnPowerups();
    expect(arena.hearts).toEqual(hearts);
    expect(arena.lightnings).toEqual(lightnings);
    hearts.forEach(heart => arena.removeHeart(heart));
    arena.spawnPowerups();
    expect(arena.hearts).toHaveLength(1);
    expect(arena.lightnings).toEqual(lightnings);
  });

  test('spawn precedes movement and collection, with no same-interval replacement after collection', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const engine = battle();
    advanceTo(engine, 75);
    engine.arena.hearts.slice().forEach(heart => engine.arena.removeHeart(heart));
    const tank = engine.arena.tanks[0];
    tank.x = 0; tank.y = 1;
    const healthBefore = tank.health;
    tank.takeDamage();
    engine.resolveTick({ 1: 'moveUp' });
    expect([tank.x, tank.y, tank.health]).toEqual([0, 0, healthBefore]);
    expect(engine.arena.hearts).toEqual([]);
    engine.resolveTick({ 1: 'moveDown' });
    expect(engine.arena.hearts).toEqual([]);
  });

  test('reading state while paused cannot trigger an interval; a fresh battle restarts at zero', () => {
    const engine = battle();
    const spawn = jest.spyOn(engine.arena, 'spawnPowerups');
    advanceTo(engine, 75);
    for (let frame = 0; frame < 100; frame++) engine.getTankScriptStates();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(engine.getTickCount()).toBe(75);
    engine.resolveTick({});
    expect(spawn).toHaveBeenCalledTimes(2);
    const restarted = battle();
    expect(restarted.getTickCount()).toBe(0);
    expect(restarted.arena.hearts).toEqual([]);
    restarted.resolveTick({});
    expect(restarted.arena.hearts).toHaveLength(1);
    expect(restarted.arena.lightnings).toHaveLength(1);
  });

  test('new pickups appear in frozen snapshots without changing old snapshots', () => {
    const engine = battle();
    engine.resolveTick({});
    engine.arena.hearts.slice().forEach(heart => engine.arena.removeHeart(heart));
    engine.arena.lightnings.slice().forEach(lightning => engine.arena.removeLightning(lightning));
    advanceTo(engine, 75);
    const before = engine.getTankScriptStates()[0];
    expect(before.allPowerups).toEqual([]);
    engine.resolveTick({});
    const after = engine.getTankScriptStates()[0];
    expect(after.allPowerups.map(pickup => pickup.type)).toEqual(['heart', 'lightning']);
    expect(Object.isFrozen(after.allPowerups)).toBe(true);
    for (const pickup of after.allPowerups) expect(Object.isFrozen(pickup)).toBe(true);
    expect(() => { after.allPowerups[0].x = 99; }).toThrow(TypeError);
    expect(engine.arena.hearts[0].x).not.toBe(99);
    expect(before.allPowerups).toEqual([]);
  });

  test('static command generation neither spawns nor advances the scenario', () => {
    const engine = new BattleEngine(8, 8, false, true);
    engine.arena.addHeart(new Heart(3, 2));
    const spawn = jest.spyOn(engine.arena, 'spawnPowerups');
    const command = engine.debugGenerateCommand([
      new Tank(1, 'Player', 1, 2, ''), new Tank(2, 'Dummy', 7, 7, ''),
    ], [], 'if (allPowerups.length === 1 && allPowerups[0].type === "heart") moveRight();', 1);
    expect(command).toEqual({ action: 'moveRight' });
    expect(spawn).not.toHaveBeenCalled();
    expect(engine.getTickCount()).toBe(0);
    expect(engine.arena.tanks[0].x).toBe(1);
    expect(engine.arena.hearts).toEqual([new Heart(3, 2)]);
    expect(engine.arena.lightnings).toEqual([]);
  });

  test.each(['elimination', 'mutual-destruction', 'stalemate', 'timeout'])('never replenishes after %s ends a battle', reason => {
    const engine = battle();
    const spawn = jest.spyOn(engine.arena, 'spawnPowerups');
    engine.resolveTick({});
    if (reason === 'elimination' || reason === 'mutual-destruction') {
      engine.arena.tanks[1].takeDamage(100);
      if (reason === 'mutual-destruction') engine.arena.tanks[0].takeDamage(100);
    }
    let result;
    do {
      const commands = reason === 'timeout' && engine.getTickCount() % 60 === 59 ? { 1: 'moveLeft' } : {};
      result = engine.resolveTick(commands);
    } while (!result);
    expect(result.reason).toBe(reason);
    const attempts = spawn.mock.calls.length;
    engine.arena.hearts.slice().forEach(heart => engine.arena.removeHeart(heart));
    engine.arena.lightnings.slice().forEach(lightning => engine.arena.removeLightning(lightning));
    for (let tick = 0; tick < 76; tick++) engine.resolveTick({});
    expect(spawn).toHaveBeenCalledTimes(attempts);
    expect(engine.arena.hearts).toEqual([]);
    expect(engine.arena.lightnings).toEqual([]);
    if (reason === 'stalemate') expect(result.tickCount).toBe(125);
    if (reason === 'timeout') expect(result.tickCount).toBe(1000);
  });
});
