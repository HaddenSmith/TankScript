import { describe, expect, test } from '@jest/globals';
import { BattleEngine } from '../../../frontend/src/game/engine/battleEngine.js';
import { Tank } from '../../../frontend/src/game/engine/tank.js';
import { Bullet } from '../../../frontend/src/game/engine/bullet.js';
import { Wall } from '../../../frontend/src/game/engine/wall.js';
import { Heart } from '../../../frontend/src/game/engine/heart.js';
import { Lightning } from '../../../frontend/src/game/engine/lightning.js';
import { serializeTankSnapshot } from '../../../frontend/src/game/tank-script/shared/tankScriptRunnerProtocol.js';
import { createDebuggerTankState, createDefaultDebuggerScenario } from '../../../frontend/src/tank-editor/debugger/scenario.js';

function scenario() {
  const engine = new BattleEngine(8, 8, false, true);
  const tank = new Tank(1, 'Collector', 1, 2, '', 5);
  tank.takeDamage(2);
  engine.addTank(tank);
  engine.addTank(new Tank(2, 'Other', 7, 7, ''));
  engine.arena.addWall(new Wall(3, 3));
  engine.arena.addWall(new Wall(4, 4, 0));
  engine.arena.addHeart(new Heart(2, 2));
  engine.arena.addLightning(new Lightning(2, 3));
  engine.arena.addBullet(new Bullet(20, 1, 5.5, 0, 0));
  tank.lightningPowerup(true);
  engine.arena.addBullet(new Bullet(21, 1, 5.5, 1, 0, 1));
  return { engine, tank };
}

describe('shared arena scripting snapshots', () => {
  test('publishes living walls, pickups, tank abilities and captured bullet speeds as frozen plain data', () => {
    const { engine } = scenario();
    const [state, other] = engine.getTankScriptStates();
    expect(state).toMatchObject({ tankHealth: 3, tankMaxHealth: 5, tankBulletSpeed: 1, tankLightningTicksRemaining: 50 });
    expect(state.allWalls).toEqual([{ x: 3, y: 3, health: 10, maxHealth: 10 }]);
    expect(state.allPowerups).toEqual([{ type: 'heart', x: 2, y: 2 }, { type: 'lightning', x: 2, y: 3 }]);
    expect(state.allTanks[0]).toMatchObject({ health: 3, maxHealth: 5, bulletSpeed: 1, lightningTicksRemaining: 50 });
    expect(state.allBullets.map(bullet => bullet.speed)).toEqual([0.5, 1]);
    expect(other.allWalls).toBe(state.allWalls);
    expect(other.allPowerups).toBe(state.allPowerups);
    for (const value of [state, state.tankPosition, state.allTanks, state.allBullets, state.allWalls, state.allPowerups,
      ...state.allTanks, ...state.allBullets, ...state.allWalls, ...state.allPowerups]) expect(Object.isFrozen(value)).toBe(true);
    expect(() => { state.allWalls[0].health = 0; }).toThrow(TypeError);
    expect(() => { state.allPowerups[0].type = 'lightning'; }).toThrow(TypeError);
    expect(() => { state.allTanks[0].maxHealth = 999; }).toThrow(TypeError);
    expect(() => { state.allBullets[0].speed = 99; }).toThrow(TypeError);
    expect(state.allTanks[0]).not.toHaveProperty('code');
    expect(state.allWalls[0]).not.toHaveProperty('takeDamage');
    expect(engine.arena.walls[0].health).toBe(10);
  });

  test('updates collection, destruction and expiration without mutating previous snapshots', () => {
    const { engine, tank } = scenario();
    const before = engine.getTankScriptStates()[0];
    engine.resolveTick({ 1: 'moveRight' });
    expect(engine.getTankScriptStates()[0]).toMatchObject({ tankHealth: 4, tankMaxHealth: 5 });
    expect(engine.getTankScriptStates()[0].allPowerups).toEqual([{ type: 'lightning', x: 2, y: 3 }]);
    engine.resolveTick({ 1: 'moveDown' });
    expect(engine.getTankScriptStates()[0].allPowerups).toEqual([]);
    expect(engine.getTankScriptStates()[0].tankLightningTicksRemaining).toBe(50);
    engine.arena.walls[0].takeDamage(10);
    for (let tick = 0; tick < 50; tick++) engine.resolveTick({});
    const after = engine.getTankScriptStates()[0];
    expect(after).toMatchObject({ tankBulletSpeed: 0.5, tankLightningTicksRemaining: 0, allWalls: [], allPowerups: [] });
    expect(before).toMatchObject({ tankHealth: 3, tankBulletSpeed: 1, tankLightningTicksRemaining: 50 });
    expect(before.allWalls[0].health).toBe(10);
    expect(before.allPowerups).toHaveLength(2);
    expect(tank.health).toBe(4);
  });

  test('trusted scripts see the same pre-tick state and still use only their first action', () => {
    const { engine, tank } = scenario();
    tank.code = `
      if (allWalls[0].maxHealth !== 10 || tankMaxHealth !== 5 || tankBulletSpeed !== 1) throw Error('snapshot');
      try { allWalls[0].health = 0; } catch {}
      if (allPowerups.some(p => p.type === 'heart')) moveRight();
      shoot();
    `;
    engine.arena.tanks[1].code = 'if (allTanks[0].health === 3 && allPowerups.length === 2) shoot();';
    engine.tick();
    expect([tank.x, tank.y, tank.health]).toEqual([2, 2, 4]);
    expect(engine.arena.bullets.some(bullet => bullet.ownerId === 2)).toBe(true);
    expect(engine.arena.walls[0].health).toBe(10);
  });

  test('the static Debugger uses the same plain schema without advancing state', () => {
    const scene = createDefaultDebuggerScenario();
    scene.walls.push({ id: 1, x: 3, y: 2, health: 10, maxHealth: 10 }, { id: 2, x: 4, y: 2, health: 0, maxHealth: 10 });
    scene.hearts.push({ id: 1, x: 3, y: 3 });
    scene.lightnings.push({ id: 2, x: 4, y: 3 });
    const state = createDebuggerTankState(scene);
    expect(state).toMatchObject({ tankMaxHealth: 3, tankBulletSpeed: 0.5, tankLightningTicksRemaining: 0 });
    expect(state.allWalls).toEqual([{ x: 3, y: 2, health: 10, maxHealth: 10 }]);
    expect(state.allPowerups).toEqual([{ type: 'heart', x: 3, y: 3 }, { type: 'lightning', x: 4, y: 3 }]);
    expect(Object.isFrozen(state.allPowerups[0])).toBe(true);
    scene.hearts[0].x = 5;
    expect(state.allPowerups[0].x).toBe(3);
    expect(createDebuggerTankState(scene).allPowerups[0].x).toBe(5);
    expect(scene.allTanks[0].health).toBe(3);
  });

  test('transport keeps only the extended schema and supports old snapshot shapes', () => {
    const { engine } = scenario();
    const state = engine.getTankScriptStates()[0];
    expect(JSON.parse(serializeTankSnapshot(state))).toEqual(state);
    const old = { tankId: 1, tankPosition: { x: 1, y: 2 }, tankHealth: 2, tankRotation: 0,
      allTanks: [{ id: 1, name: 'Legacy', x: 1, y: 2, health: 2, rotation: 0, code: 'private' }],
      allBullets: [{ id: 1, ownerId: 1, x: 1.5, y: 2, rotation: 0 }], arenaWidth: 8, arenaHeight: 8 };
    const normalized = JSON.parse(serializeTankSnapshot(old));
    expect(normalized).toMatchObject({ allWalls: [], allPowerups: [], tankMaxHealth: 2, tankBulletSpeed: 0.5, tankLightningTicksRemaining: 0 });
    expect(normalized.allTanks[0]).not.toHaveProperty('code');
    expect(normalized.allBullets[0].speed).toBe(0.5);
    for (const invalid of [
      { allWalls: null }, { allPowerups: [{ type: 'other', x: 1, y: 1 }] },
      { allWalls: [{ x: NaN, y: 1, health: 10, maxHealth: 10 }] },
      { allPowerups: Array(4096).fill({ type: 'heart', x: 1, y: 1 }) },
      { tankBulletSpeed: Infinity }, { tankLightningTicksRemaining: null },
    ]) expect(() => serializeTankSnapshot({ ...state, ...invalid })).toThrow(expect.objectContaining({ code: 'INVALID_SNAPSHOT' }));
  });
});
