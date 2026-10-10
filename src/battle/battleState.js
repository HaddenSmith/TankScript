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

export function createBattleEventsFromSnapshots(previousSnapshot, currentSnapshot, result) {
  if (!previousSnapshot) return [];

  const previousTanks = previousSnapshot.arena.tanks;
  const currentTanks = currentSnapshot.arena.tanks;
  const events = [];

  currentTanks.forEach((tank) => {
    const previousTank = previousTanks.find((item) => item.id === tank.id);
    if (!previousTank) return;

    const name = tank.name ?? `Tank ${tank.id}`;
    if (previousTank.x !== tank.x || previousTank.y !== tank.y) {
      events.push(`${name} moved to [${tank.x}, ${tank.y}].`);
    }
    if (previousTank.rotation !== tank.rotation) {
      events.push(`${name} rotated to ${tank.rotation} degrees.`);
    }
    if (tank.health < previousTank.health) {
      events.push(`${name} took damage (${previousTank.health} -> ${tank.health} health).`);
    }
    if (previousTank.health > 0 && tank.health <= 0) {
      events.push(`${name} was destroyed.`);
    }
  });

  const previousBulletIds = new Set(
    previousSnapshot.arena.bullets.map((bullet) => bullet.id),
  );
  const tankNames = new Map(currentTanks.map((tank) => [tank.id, tank.name]));
  currentSnapshot.arena.bullets.forEach((bullet) => {
    if (!previousBulletIds.has(bullet.id)) {
      events.push(`${tankNames.get(bullet.ownerId) ?? `Tank ${bullet.ownerId}`} fired a bullet.`);
    }
  });

  if (result) {
    events.push('Battle ended.');
    if (result.status === 'win') {
      events.push(`${result.winner.name} wins the battle.`);
    } else if (result.status === 'tie') {
      events.push("The battle ended in a tie.");
    }
  }

  return events;
}
