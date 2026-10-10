export function createBattleStateSnapshot(engine, startingHealth) {
  return {
    startingHealth,
    arena: {
      width: engine.arena.width,
      height: engine.arena.height,
      tanks: engine.arena.tanks.map((tank) => ({
        id: tank.id,
        name: tank.name,
        x: tank.x,
        y: tank.y,
        rotation: tank.rotation,
        health: tank.health,
        side: tank.side,
        color: tank.color,
      })),
      bullets: engine.arena.bullets.map((bullet) => ({
        id: bullet.id,
        ownerId: bullet.ownerId,
        x: bullet.x,
        y: bullet.y,
        rotation: bullet.rotation,
      })),
    },
  };
}
