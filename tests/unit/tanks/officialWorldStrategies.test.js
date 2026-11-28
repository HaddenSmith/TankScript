import { describe, expect, jest, test } from '@jest/globals';
import easy from '../../../frontend/src/game/builtInTanks/easyTank.js';
import medium from '../../../frontend/src/game/builtInTanks/mediumTank.js';
import hard from '../../../frontend/src/game/builtInTanks/hardTank.js';
import expert from '../../../frontend/src/game/builtInTanks/expertTank.js';
import overkill from '../../../frontend/src/game/builtInTanks/overkillTank.js';
import { geometryCode } from '../../../frontend/src/game/builtInTanks/tacticalCode.js';
import { BattleEngine } from '../../../frontend/src/game/engine/battleEngine.js';
import { Tank } from '../../../frontend/src/game/engine/tank.js';
import { Bullet } from '../../../frontend/src/game/engine/bullet.js';
import { Wall } from '../../../frontend/src/game/engine/wall.js';
import { Heart } from '../../../frontend/src/game/engine/heart.js';
import { Lightning } from '../../../frontend/src/game/engine/lightning.js';
import { createTankScriptApi } from '../../../frontend/src/game/tank-script/shared/tankScriptApi.js';
import { executeTankScript } from '../../../frontend/src/game/tank-script/javascript/tankScriptExecutor.js';

const official = [easy, medium, hard, expert, overkill];
const advanced = [hard, expert, overkill];
const offsets = { moveUp: [0, -1], moveRight: [1, 0], moveDown: [0, 1], moveLeft: [-1, 0] };
function world(x = 3, y = 3, enemyX = 0, enemyY = 0, health = 3) {
  const engine = new BattleEngine(8, 8);
  const own = new Tank(1, 'Own', x, y, '', health);
  const enemy = new Tank(2, 'Enemy', enemyX, enemyY, '');
  engine.addTank(own); engine.addTank(enemy);
  return { engine, own, enemy };
}
function command(source, state) {
  const api = createTankScriptApi();
  let calls = 0;
  const actions = Object.fromEntries(Object.entries(api).filter(([name]) => name !== 'getSubmittedCommand')
    .map(([name, act]) => [name, () => { calls++; act(); }]));
  const before = JSON.stringify(state);
  const random = jest.spyOn(Math, 'random').mockReturnValue(0.5);
  try { executeTankScript(source, actions, state); }
  finally { random.mockRestore(); }
  expect(JSON.stringify(state)).toBe(before);
  expect(calls).toBeLessThanOrEqual(1);
  return api.getSubmittedCommand()?.action;
}
function choose(definition, engine) { return command(definition.code, engine.getTankScriptStates()[0]); }

describe('official tank arena strategies', () => {
  test.each(official.map(tank => [tank.name, tank]))('%s never requests movement into known walls, wrecks or boundaries', (_name, definition) => {
    const { engine, own } = world(0, 0, 6, 6);
    engine.arena.addWall(new Wall(1, 0));
    engine.addTank(new Tank(3, 'Wreck', 0, 1, '', 0));
    for (const rotation of [0, 90, 180, 270]) {
      own.rotation = rotation;
      expect(offsets[choose(definition, engine)]).toBeUndefined();
    }
  });

  test.each(advanced.map(tank => [tank.name, tank]))('%s pursues a reachable heart when damaged and respects maximum health', (_name, definition) => {
    const { engine, own } = world(3, 3, 0, 0, 6);
    own.takeDamage(3);
    engine.arena.addHeart(new Heart(4, 3));
    expect(choose(definition, engine)).toBe('moveRight');
    own.heal(3);
    expect(choose(definition, engine)).not.toBe('moveRight');
  });

  test.each(advanced.map(tank => [tank.name, tank]))('%s seeks a useful Lightning refresh without chasing an already-active upgrade', (_name, definition) => {
    const { engine, own } = world();
    engine.arena.addLightning(new Lightning(4, 3));
    expect(choose(definition, engine)).toBe('moveRight');
    own.lightningPowerup(true);
    expect(choose(definition, engine)).not.toBe('moveRight');
    for (let tick = 0; tick < 29; tick++) own.advanceLightningTick();
    expect(choose(definition, engine)).toBe('moveRight');
  });

  test.each(advanced.map(tank => [tank.name, tank]))('%s notices new pickup batches after earlier pickups disappear', (_name, definition) => {
    const { engine, own } = world();
    own.takeDamage(1);
    const first = new Heart(4, 3);
    engine.arena.addHeart(first);
    expect(choose(definition, engine)).toBe('moveRight');
    engine.arena.removeHeart(first);
    expect(choose(definition, engine)).not.toBe('moveRight');
    // Inject later batches without changing the engine's current spawning rules.
    engine.arena.addHeart(new Heart(3, 4));
    expect(choose(definition, engine)).toBe('moveDown');
    own.heal(1);
    engine.arena.removeHeart(engine.arena.hearts[0]);
    engine.arena.addLightning(new Lightning(4, 3));
    expect(choose(definition, engine)).toBe('moveRight');
    own.lightningPowerup(true);
    expect(choose(definition, engine)).not.toBe('moveRight');
    for (let tick = 0; tick < 29; tick++) own.advanceLightningTick();
    expect(choose(definition, engine)).toBe('moveRight');
    own.lightningPowerup(true);
    expect(own.lightningTicksRemaining).toBe(30);
    expect(choose(definition, engine)).not.toBe('moveRight');
  });

  test.each(advanced.map(tank => [tank.name, tank]))('%s walks around strong cover and shoots through weak cover', (_name, definition) => {
    const { engine } = world(2, 3, 5, 3);
    for (let y = 1; y <= 6; y++) engine.arena.addWall(new Wall(3, y));
    expect(choose(definition, engine)).toBe('moveUp');
    engine.arena.getWallByPosition(3, 3).takeDamage(9);
    expect(choose(definition, engine)).toBe('shoot');
    engine.resolveTick({ 1: 'shoot' });
    engine.resolveTick({});
    expect(engine.getTankScriptStates()[0].allWalls.some(wall => wall.x === 3 && wall.y === 3)).toBe(false);
  });

  test.each(advanced.map(tank => [tank.name, tank]))('%s opens a sealed room rather than endlessly rotating', (_name, definition) => {
    const { engine, own } = world(3, 3, 6, 6);
    for (const [x, y] of [[3, 2], [4, 3], [3, 4], [2, 3]]) engine.arena.addWall(new Wall(x, y));
    for (let tick = 0; tick < 40 && engine.arena.walls.every(wall => !wall.isDestroyed()); tick++) {
      engine.resolveTick({ 1: choose(definition, engine) });
    }
    expect(engine.arena.walls.some(wall => wall.isDestroyed())).toBe(true);
    expect(own.health).toBe(3);
  });

  test('Firefly is a predictable single-shot scout and does not pursue pickups', () => {
    const { engine } = world(2, 2, 6, 2);
    expect(choose(easy, engine)).toBe('shoot');
    engine.arena.addBullet(new Bullet(1, 1, 2.5, 2, 0));
    expect(choose(easy, engine)).toBe('rotateLeft');
    engine.arena.addHeart(new Heart(2, 3));
    expect(choose(easy, engine)).toBe('rotateLeft');
  });

  test('dead walls do not remain navigation obstacles and absent pickups need no special setup', () => {
    const { engine } = world(2, 2, 6, 5);
    const before = advanced.map(definition => choose(definition, engine));
    engine.arena.addWall(new Wall(3, 2, 0));
    expect(advanced.map(definition => choose(definition, engine))).toEqual(before);
  });
});

describe('public-state bullet forecasts', () => {
  test.each([0.5, 1])('matches immediate engine hits for speed %s and every movement direction', speed => {
    for (const rotation of [0, 90, 180, 270]) {
      for (const [action, [dx, dy]] of Object.entries({ wait: [0, 0], ...offsets })) {
        for (const [x, y] of [[2.5, 3], [3.5, 3], [4.5, 3], [3, 2.5], [3, 3.5], [3, 4.5]]) {
          const { engine, own } = world(3, 3, 7, 7);
          engine.arena.addBullet(new Bullet(1, 2, x, y, rotation, speed));
          const prediction = command(geometryCode + `if (bulletPathDanger(me, {x:me.x+${dx},y:me.y+${dy}}, 1)) shoot(); else rotateLeft();`, engine.getTankScriptStates()[0]);
          engine.resolveTick({ 1: action === 'wait' ? undefined : action });
          expect(prediction === 'shoot').toBe(own.health < 3);
        }
      }
    }
  });

  test('uses captured bullet speed even after its owner loses Lightning', () => {
    const { engine, enemy } = world(3, 3, 7, 7);
    engine.arena.addBullet(new Bullet(1, 2, 5, 3, 180, 1));
    const source = geometryCode + 'if (bulletPathDanger(me, {x:4,y:3}, 1)) shoot(); else rotateLeft();';
    expect(command(source, engine.getTankScriptStates()[0])).toBe('shoot');
    engine.arena.bullets[0].speed = 0.5;
    enemy.lightningPowerup(true);
    expect(command(source, engine.getTankScriptStates()[0])).toBe('rotateLeft');
  });

  test('enemy Lightning increases gun threat until expiration, while cover blocks the lane', () => {
    const { engine, enemy } = world(3, 3, 6, 3);
    enemy.rotation = 180;
    const source = geometryCode + 'if (muzzleDanger(me) > 0.2) moveUp(); else shoot();';
    expect(command(source, engine.getTankScriptStates()[0])).toBe('shoot');
    enemy.lightningPowerup(true);
    expect(command(source, engine.getTankScriptStates()[0])).toBe('moveUp');
    enemy.lightningTicksRemaining = 1;
    expect(command(source, engine.getTankScriptStates()[0])).toBe('moveUp');
    enemy.advanceLightningTick();
    expect(command(source, engine.getTankScriptStates()[0])).toBe('shoot');
    enemy.lightningPowerup(true);
    engine.arena.addWall(new Wall(4, 3));
    expect(command(source, engine.getTankScriptStates()[0])).toBe('shoot');
  });

  test('living cover stops a future fast bullet, while destroyed cover does not', () => {
    const { engine } = world(3, 3, 7, 7);
    engine.arena.addBullet(new Bullet(1, 2, 5.5, 3, 180, 1));
    const wall = new Wall(4, 3);
    engine.arena.addWall(wall);
    const source = geometryCode + 'if (bulletDanger(me, 3)) shoot(); else rotateLeft();';
    expect(command(source, engine.getTankScriptStates()[0])).toBe('rotateLeft');
    wall.takeDamage(10);
    expect(command(source, engine.getTankScriptStates()[0])).toBe('shoot');
  });

  test('respects original-occupant priority when another tank follows into its old position', () => {
    const { engine, enemy } = world(2, 3, 3, 3);
    engine.arena.addBullet(new Bullet(1, 1, 3, 2.5, 270));
    const source = geometryCode + 'if (bulletPathDanger(me, {x:3,y:3}, 1)) shoot(); else rotateLeft();';
    expect(command(source, engine.getTankScriptStates()[0])).toBe('rotateLeft');
    engine.resolveTick({ 1: 'moveRight', 2: 'moveRight' });
    expect(enemy.health).toBe(2);
    expect(engine.arena.tanks[0].health).toBe(3);
  });
});
