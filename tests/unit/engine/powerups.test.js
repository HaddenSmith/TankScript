import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { Arena } from '../../../frontend/src/game/engine/arena.js';
import { BattleEngine } from '../../../frontend/src/game/engine/battleEngine.js';
import { Bullet } from '../../../frontend/src/game/engine/bullet.js';
import { Heart } from '../../../frontend/src/game/engine/heart.js';
import { Lightning } from '../../../frontend/src/game/engine/lightning.js';
import { Tank } from '../../../frontend/src/game/engine/tank.js';
import { Wall } from '../../../frontend/src/game/engine/wall.js';

afterEach(() => jest.restoreAllMocks());

function addTank(engine, id, x, y, health = 3) {
  const tank = new Tank(id, `Tank ${id}`, x, y, '', health);
  engine.addTank(tank);
  return tank;
}

const powerups = [
  ['heart', Heart, 'addHeart', 'getHeartByPosition', 'removeHeart', 'hearts'],
  ['lightning', Lightning, 'addLightning', 'getLightningByPosition', 'removeLightning', 'lightnings'],
];

describe.each(powerups)('%s storage and placement', (name, Powerup, add, get, remove, collection) => {
  test('keeps the original simple coordinate object and supports lookup/removal', () => {
    const arena = new Arena(8, 6);
    const powerup = new Powerup(2, 3);
    expect(powerup).toEqual({ x: 2, y: 3 });
    arena[add](powerup);
    expect(arena[get](2, 3)).toBe(powerup);
    expect(arena[get](3, 2)).toBeUndefined();
    arena[remove](powerup);
    arena[remove](powerup);
    expect(arena[collection]).toEqual([]);
  });

  test.each([[-1, 0], [0, -1], [8, 0], [0, 6], [0.5, 2], [2, 0.5], [NaN, 2], [2, Infinity]])(
    'rejects an invalid position (%s, %s)', (x, y) => {
      const arena = new Arena(8, 6);
      expect(() => arena[add](new Powerup(x, y))).toThrow(/empty in-bounds grid cell/);
      expect(arena[collection]).toEqual([]);
    },
  );

  test('allows all boundary corners and positions of destroyed walls', () => {
    const arena = new Arena(8, 6);
    for (const [x, y] of [[0, 0], [7, 0], [0, 5], [7, 5]]) arena[add](new Powerup(x, y));
    arena.addWall(new Wall(3, 3, 0));
    arena[add](new Powerup(3, 3));
    expect(arena[collection]).toHaveLength(5);
  });

  test('rejects living walls, tanks, wrecks, either power-up type, and cells touched by bullets', () => {
    const arena = new Arena(8, 8);
    arena.addWall(new Wall(1, 1));
    arena.addTank(new Tank(1, 'Alive', 2, 2, ''));
    arena.addTank(new Tank(2, 'Wreck', 3, 3, '', 0));
    arena.addHeart(new Heart(4, 4));
    arena.addLightning(new Lightning(5, 5));
    arena.addBullet(new Bullet(1, 1, 6.5, 6, 0));
    for (const [x, y] of [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 6]]) {
      expect(() => arena[add](new Powerup(x, y))).toThrow(/empty in-bounds grid cell/);
    }
  });

  test('rejects placing tanks or walls over an existing pickup', () => {
    const arena = new Arena(8, 8);
    arena[add](new Powerup(2, 2));
    expect(() => arena.addTank(new Tank(1, 'Overlap', 2, 2, ''))).toThrow(/power-up/);
    expect(() => arena.addWall(new Wall(2, 2))).toThrow(/power-up/);
  });
});

describe('power-up spawning', () => {
  test('spawns one of each in free cells without replacing existing objects', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const arena = new Arena(8, 8);
    arena.addTank(new Tank(1, 'Tank', 0, 0, ''));
    arena.addWall(new Wall(1, 0));
    arena.addBullet(new Bullet(1, 1, 2.5, 0, 0));
    arena.spawnPowerups();
    expect(arena.hearts).toEqual([new Heart(4, 0)]);
    expect(arena.lightnings).toEqual([new Lightning(5, 0)]);
    const heart = arena.hearts[0];
    const lightning = arena.lightnings[0];
    arena.spawnPowerups();
    expect(arena.hearts).toEqual([heart]);
    expect(arena.lightnings).toEqual([lightning]);
  });

  test('handles full and single-free-cell arenas without retrying forever', () => {
    const full = new Arena(1, 1);
    full.addTank(new Tank(1, 'Tank', 0, 0, ''));
    full.spawnPowerups();
    expect(full.hearts).toEqual([]);
    expect(full.lightnings).toEqual([]);
    const singleCell = new Arena(1, 1);
    singleCell.spawnPowerups();
    expect(singleCell.hearts).toEqual([new Heart(0, 0)]);
    expect(singleCell.lightnings).toEqual([]);
  });

  test('preserves placed pickups when generating walls with the existing generator', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const arena = new Arena(12, 12);
    arena.addHeart(new Heart(1, 1));
    arena.addLightning(new Lightning(2, 1));
    arena.generateWalls();
    expect(arena.walls.length).toBeGreaterThan(0);
    expect(arena.getWallByPosition(1, 1)).toBeUndefined();
    expect(arena.getWallByPosition(2, 1)).toBeUndefined();
    expect(arena.walls.every(wall => wall.health === 10)).toBe(true);
  });

  test.each([undefined, false])('stays disabled by default or explicit false (%s)', enabled => {
    const random = jest.spyOn(Math, 'random');
    const engine = new BattleEngine(8, 8, false, enabled);
    addTank(engine, 1, 1, 1);
    addTank(engine, 2, 7, 7);
    engine.resolveTick({});
    expect(engine.arena.hearts).toEqual([]);
    expect(engine.arena.lightnings).toEqual([]);
    expect(random).not.toHaveBeenCalled();
  });

  test('spawns after tank placement and never automatically respawns collected pickups', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const engine = new BattleEngine(3, 1, false, true);
    const tank = addTank(engine, 1, 0, 0);
    addTank(engine, 2, 2, 0);
    tank.takeDamage();
    engine.resolveTick({ 1: 'moveRight' });
    expect([tank.x, tank.health]).toEqual([1, 3]);
    expect(engine.arena.hearts).toEqual([]);
    expect(engine.arena.lightnings).toEqual([]);
    engine.resolveTick({ 1: 'moveLeft' });
    expect(engine.arena.hearts).toEqual([]);
    expect(engine.arena.lightnings).toEqual([]);
  });

  test('enabled random spawning respects living walls and all placed tanks', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const engine = new BattleEngine(12, 12, true, true);
    addTank(engine, 1, 0, 0);
    addTank(engine, 2, 11, 11);
    engine.resolveTick({});
    expect(engine.arena.hearts).toHaveLength(1);
    expect(engine.arena.lightnings).toHaveLength(1);
    for (const pickup of [...engine.arena.hearts, ...engine.arena.lightnings]) {
      expect(engine.arena.isPositionOccupiedByTank(pickup.x, pickup.y)).toBe(false);
      expect(engine.arena.isPositionOccupiedByWall(pickup.x, pickup.y)).toBe(false);
    }
  });
});

describe.each(powerups)('%s collection', (name, Powerup, add, get, remove, collection) => {
  test.each([['moveRight', 1, 2], ['moveLeft', 3, 2], ['moveUp', 2, 3], ['moveDown', 2, 1]])(
    'collects by %s and removes the pickup', (action, x, y) => {
      const engine = new BattleEngine(8, 8, false, true);
      const tank = addTank(engine, 1, x, y);
      tank.takeDamage();
      engine.arena[add](new Powerup(2, 2));
      engine.resolveTick({ 1: action });
      expect([tank.x, tank.y]).toEqual([2, 2]);
      expect(engine.arena[collection]).toEqual([]);
      expect(tank.health).toBe(name === 'heart' ? 3 : 2);
      expect(tank.hasLightningPowerup).toBe(name === 'lightning');
    },
  );

  test('manual scenarios do not receive extra random pickups', () => {
    const random = jest.spyOn(Math, 'random');
    const engine = new BattleEngine(8, 8, false, true);
    addTank(engine, 1, 1, 2);
    engine.arena[add](new Powerup(2, 2));
    engine.resolveTick({});
    expect(engine.arena[collection]).toHaveLength(1);
    expect(engine.arena.hearts.length + engine.arena.lightnings.length).toBe(1);
    expect(random).not.toHaveBeenCalled();
  });

  test('does not collect a manually placed pickup when power-ups are disabled', () => {
    const engine = new BattleEngine(8, 8);
    const tank = addTank(engine, 1, 1, 2);
    tank.takeDamage();
    engine.arena[add](new Powerup(2, 2));
    engine.resolveTick({ 1: 'moveRight' });
    expect(tank.health).toBe(2);
    expect(tank.hasLightningPowerup).toBe(false);
    expect(engine.arena[collection]).toHaveLength(1);
  });

  test.each([false, true])('neither simultaneous contender collects a blocked destination (reverse %s)', reverse => {
    const engine = new BattleEngine(8, 8, false, true);
    const first = new Tank(1, 'First', 1, 2, '');
    const second = new Tank(2, 'Second', 3, 2, '');
    for (const tank of reverse ? [second, first] : [first, second]) { engine.addTank(tank); tank.takeDamage(); }
    engine.arena[add](new Powerup(2, 2));
    engine.resolveTick({ 1: 'moveRight', 2: 'moveLeft' });
    expect([first.x, second.x, first.health, second.health]).toEqual([1, 3, 2, 2]);
    expect(first.hasLightningPowerup || second.hasLightningPowerup).toBe(false);
    expect(engine.arena[collection]).toHaveLength(1);
  });

  test.each([false, true])('a movement chain awards the pickup only to its arriving tank (reverse %s)', reverse => {
    const engine = new BattleEngine(8, 8, false, true);
    const follower = new Tank(1, 'Follower', 1, 2, '');
    const leader = new Tank(2, 'Leader', 2, 2, '');
    for (const tank of reverse ? [leader, follower] : [follower, leader]) { engine.addTank(tank); tank.takeDamage(); }
    engine.arena[add](new Powerup(3, 2));
    engine.resolveTick({ 1: 'moveRight', 2: 'moveRight' });
    expect([follower.x, leader.x]).toEqual([2, 3]);
    expect(follower.health).toBe(2);
    expect(follower.hasLightningPowerup).toBe(false);
    expect(leader.health).toBe(name === 'heart' ? 3 : 2);
    expect(leader.hasLightningPowerup).toBe(name === 'lightning');
    expect(engine.arena[collection]).toEqual([]);
  });

  test('a tank destroyed on arrival cannot collect or revive', () => {
    const engine = new BattleEngine(8, 8, false, true);
    const tank = addTank(engine, 1, 1, 2, 1);
    const owner = addTank(engine, 2, 7, 7);
    engine.arena[add](new Powerup(2, 2));
    engine.arena.addBullet(new Bullet(20, owner.id, 2.5, 2, 180));
    engine.resolveTick({ 1: 'moveRight' });
    expect([tank.x, tank.health, tank.hasLightningPowerup]).toEqual([2, 0, false]);
    expect(engine.arena[collection]).toHaveLength(1);
    expect([owner.damageDealt, owner.killCount]).toEqual([1, 1]);
  });

  test('ignores commands supplied directly for destroyed tanks', () => {
    const engine = new BattleEngine(8, 8, false, true);
    const tank = addTank(engine, 1, 1, 2, 0);
    engine.arena[add](new Powerup(2, 2));
    engine.resolveTick({ 1: 'moveRight' });
    expect([tank.x, tank.health, tank.hasLightningPowerup]).toEqual([1, 0, false]);
    engine.resolveTick({ 1: 'shoot' });
    expect(engine.arena.bullets).toEqual([]);
    expect(engine.arena[collection]).toHaveLength(1);
  });
});

describe('healing and lightning effects', () => {
  test.each([1, 2, 3, 4, 5])('caps healing at the original %i HP and consumes hearts even at full health', health => {
    const engine = new BattleEngine(8, 8, false, true);
    const tank = addTank(engine, 1, 1, 2, health);
    engine.arena.addHeart(new Heart(2, 2));
    engine.resolveTick({ 1: 'moveRight' });
    expect(tank.health).toBe(health);
    expect(tank.maxHealth).toBe(health);
    expect(engine.arena.hearts).toEqual([]);
    tank.takeDamage(health - 1);
    tank.heal(10);
    expect(tank.health).toBe(health);
    tank.takeDamage(health);
    tank.heal();
    expect(tank.health).toBe(0);
  });

  test('applies nonlethal bullet damage before the heart heals, while retaining damage credit', () => {
    const engine = new BattleEngine(8, 8, false, true);
    const tank = addTank(engine, 1, 1, 2);
    const owner = addTank(engine, 2, 7, 7);
    engine.arena.addHeart(new Heart(2, 2));
    engine.arena.addBullet(new Bullet(20, owner.id, 2.5, 2, 180));
    engine.resolveTick({ 1: 'moveRight' });
    expect(tank.health).toBe(3);
    expect(owner.damageDealt).toBe(1);
    expect(engine.arena.hearts).toEqual([]);
  });

  test('lightning affects future bullets only, lasts across ticks and does not stack', () => {
    const engine = new BattleEngine(8, 8, false, true);
    const tank = addTank(engine, 1, 1, 3);
    tank.rotation = 90;
    const existing = tank.shoot(20);
    engine.arena.addBullet(existing);
    engine.arena.addLightning(new Lightning(2, 3));
    engine.arena.addLightning(new Lightning(3, 3));
    engine.resolveTick({ 1: 'moveRight' });
    expect(existing.speed).toBe(0.5);
    expect(existing.y).toBe(2);
    engine.resolveTick({ 1: 'shoot' });
    const fired = engine.arena.bullets.find(bullet => bullet.id === 1);
    expect(fired).toMatchObject({ x: 2, y: 2.5, speed: 1 });
    expect(existing).toMatchObject({ y: 1.5, speed: 0.5 });
    engine.resolveTick({ 1: 'moveRight' });
    expect(fired).toMatchObject({ y: 1.5, speed: 1 });
    expect(engine.arena.lightnings).toEqual([]);
    for (let tick = 0; tick < 10; tick++) engine.resolveTick({});
    expect(tank.hasLightningPowerup).toBe(true);
    expect(tank.shoot(21).speed).toBe(1);
    tank.lightningPowerup(false);
    expect(tank.shoot(22).speed).toBe(0.5);
    expect(fired.speed).toBe(1);
  });
});
