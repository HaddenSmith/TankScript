// These bindings use an outer scope in JavaScript, allowing older local names to shadow them.
export const TANK_SCRIPT_WORLD_STATE_NAMES = Object.freeze([
  'allWalls', 'allPowerups', 'tankMaxHealth', 'tankBulletSpeed', 'tankLightningTicksRemaining',
]);

// Shared by battles and the static Debugger. Only plain, immutable data leaves the arena.
export function createTankScriptStates(arena, tanks) {
  const allTanks = Object.freeze(arena.tanks.map(tank => Object.freeze({
    id: tank.id, name: tank.name, x: tank.x, y: tank.y,
    rotation: tank.rotation, health: tank.health,
    maxHealth: tank.maxHealth ?? tank.health,
    bulletSpeed: tank.bulletSpeed ?? 0.5,
    lightningTicksRemaining: tank.lightningTicksRemaining ?? 0,
  })));
  const allBullets = Object.freeze(arena.bullets.map(bullet => Object.freeze({
    id: bullet.id, ownerId: bullet.ownerId, x: bullet.x, y: bullet.y,
    rotation: bullet.rotation, speed: bullet.speed ?? 0.5,
  })));
  const allWalls = Object.freeze((arena.walls ?? [])
    .filter(wall => wall.health > 0)
    .map(wall => Object.freeze({ x: wall.x, y: wall.y, health: wall.health, maxHealth: wall.maxHealth ?? wall.health })));
  const allPowerups = Object.freeze([
    ...(arena.hearts ?? []).map(heart => Object.freeze({ type: 'heart', x: heart.x, y: heart.y })),
    ...(arena.lightnings ?? []).map(lightning => Object.freeze({ type: 'lightning', x: lightning.x, y: lightning.y })),
  ]);

  return tanks.map(tank => {
    const ownTank = allTanks.find(entry => entry.id === tank.id);
    return Object.freeze({
      tankId: tank.id,
      tankPosition: Object.freeze({ x: tank.x, y: tank.y }),
      tankRotation: tank.rotation,
      tankHealth: tank.health,
      tankMaxHealth: ownTank.maxHealth,
      tankBulletSpeed: ownTank.bulletSpeed,
      tankLightningTicksRemaining: ownTank.lightningTicksRemaining,
      allTanks, allBullets, allWalls, allPowerups,
      arenaWidth: arena.width, arenaHeight: arena.height,
    });
  });
}
