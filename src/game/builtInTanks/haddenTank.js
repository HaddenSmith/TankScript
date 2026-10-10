const haddenTank = {
  id: 'hadden-hard',
  name: "Hadden's Tank (Hard)",
  code: `
const opponents = allTanks.filter((tank) => tank.id !== tankId && tank.health > 0);
const target = opponents.reduce((closest, tank) => {
  if (!closest) return tank;
  const distance = Math.hypot(tank.x - tankPosition.x, tank.y - tankPosition.y);
  const closestDistance = Math.hypot(closest.x - tankPosition.x, closest.y - tankPosition.y);
  return distance < closestDistance ? tank : closest;
}, null);

function isFacingMe(bullet, position = tankPosition) {
  if (bullet.rotation === 0) return bullet.y === position.y && bullet.x <= position.x;
  if (bullet.rotation === 90) return bullet.x === position.x && bullet.y >= position.y;
  if (bullet.rotation === 180) return bullet.y === position.y && bullet.x >= position.x;
  if (bullet.rotation === 270) return bullet.x === position.x && bullet.y <= position.y;
  return false;
}

function moveAction(direction) {
  let action = direction;
  let nextX = tankPosition.x;
  let nextY = tankPosition.y;

  if (direction === 'moveLeft') nextX -= 1;
  if (direction === 'moveRight') nextX += 1;
  if (direction === 'moveUp') nextY -= 1;
  if (direction === 'moveDown') nextY += 1;

  if (nextX < 0 || nextX >= arenaWidth || nextY < 0 || nextY >= arenaHeight) {
    if (direction === 'moveLeft') action = 'moveRight';
    else if (direction === 'moveRight') action = 'moveLeft';
    else if (direction === 'moveUp') action = 'moveDown';
    else action = 'moveUp';

    nextX = tankPosition.x;
    nextY = tankPosition.y;
    if (action === 'moveLeft') nextX -= 1;
    if (action === 'moveRight') nextX += 1;
    if (action === 'moveUp') nextY -= 1;
    if (action === 'moveDown') nextY += 1;
  }

  const occupied = allTanks.some((tank) =>
    tank.id !== tankId && tank.health > 0 && tank.x === nextX && tank.y === nextY
  );
  const threatened = allBullets.some((bullet) => {
    return bullet.ownerId !== tankId &&
      Math.hypot(bullet.x - nextX, bullet.y - nextY) <= 3 &&
      isFacingMe(bullet, { x: nextX, y: nextY });
  });

  if (occupied || threatened || (nextX === tankPosition.x && nextY === tankPosition.y)) return null;
  return action;
}

function submitMove(direction) {
  const action = moveAction(direction);
  if (action === 'moveLeft') moveLeft();
  else if (action === 'moveRight') moveRight();
  else if (action === 'moveUp') moveUp();
  else if (action === 'moveDown') moveDown();
  return action !== null;
}

function turnToward(desiredRotation) {
  const turn = (desiredRotation - tankRotation + 360) % 360;
  if (turn === 90) rotateLeft();
  else if (turn === 270) rotateRight();
  else if (turn === 180) rotateLeft();
}

if (target) {
  const distanceToTarget = Math.hypot(target.x - tankPosition.x, target.y - tankPosition.y);
  let dodged = false;
  for (const bullet of allBullets) {
    const isThreatening = bullet.ownerId !== tankId &&
      (bullet.x === tankPosition.x || bullet.y === tankPosition.y) &&
      isFacingMe(bullet) &&
      Math.hypot(bullet.x - tankPosition.x, bullet.y - tankPosition.y) <= 3.5;
    if (!isThreatening) continue;

    const dodgeDirections = bullet.y === tankPosition.y
      ? (target.y > tankPosition.y ? ['moveDown', 'moveUp'] : ['moveUp', 'moveDown'])
      : (target.x > tankPosition.x ? ['moveRight', 'moveLeft'] : ['moveLeft', 'moveRight']);
    dodged = submitMove(dodgeDirections[0]);
    if (!dodged) dodged = submitMove(dodgeDirections[1]);
    if (dodged) break;
  }

  let adjacentThreatHandled = false;
  if (!dodged) {
    for (const tank of opponents) {
      let escapeDirection = null;
      if (tank.x === tankPosition.x - 1 && tank.y === tankPosition.y && tank.rotation === 0) {
        escapeDirection = tankPosition.x === arenaWidth - 1 ? 'moveUp' : 'moveRight';
      } else if (tank.x === tankPosition.x + 1 && tank.y === tankPosition.y && tank.rotation === 180) {
        escapeDirection = tankPosition.x === 0 ? 'moveLeft' : 'moveUp';
      } else if (tank.y === tankPosition.y - 1 && tank.x === tankPosition.x && tank.rotation === 270) {
        escapeDirection = tankPosition.y === arenaHeight - 1 ? 'moveRight' : 'moveDown';
      } else if (tank.y === tankPosition.y + 1 && tank.x === tankPosition.x && tank.rotation === 90) {
        escapeDirection = tankPosition.y === 0 ? 'moveLeft' : 'moveUp';
      }

      if (escapeDirection) {
        adjacentThreatHandled = submitMove(escapeDirection);
        if (adjacentThreatHandled) break;
      }
    }
  }

  if (!dodged && !adjacentThreatHandled) {
    const dx = tankPosition.x - target.x;
    const dy = tankPosition.y - target.y;
    let lineUpDirection = null;
    if (Math.abs(dx) > Math.abs(dy) && dy !== 0) {
      lineUpDirection = target.y > tankPosition.y ? 'moveDown' : 'moveUp';
    } else if (Math.abs(dx) <= Math.abs(dy) && dx !== 0) {
      lineUpDirection = target.x > tankPosition.x ? 'moveRight' : 'moveLeft';
    }

    const linedUp = tankPosition.x === target.x || tankPosition.y === target.y;
    const moveTowardDirection = linedUp
      ? (tankPosition.x === target.x
        ? (target.y > tankPosition.y ? 'moveDown' : 'moveUp')
        : (target.x > tankPosition.x ? 'moveRight' : 'moveLeft'))
      : (Math.abs(dx) > Math.abs(dy)
        ? (target.x > tankPosition.x ? 'moveRight' : 'moveLeft')
        : (target.y > tankPosition.y ? 'moveDown' : 'moveUp'));
    const shouldApproach = !linedUp || distanceToTarget >= 3.5;

    if (lineUpDirection && submitMove(lineUpDirection)) {
      // Keep the original lineup decision ahead of approach, facing, and firing.
    } else if (
      moveTowardDirection &&
      shouldApproach &&
      submitMove(moveTowardDirection)
    ) {
      // Keep the original approach decision ahead of facing and firing.
    } else {
      let desiredRotation = null;
      if (target.x !== tankPosition.x) {
        desiredRotation = target.x > tankPosition.x ? 0 : 180;
      } else if (target.y !== tankPosition.y) {
        desiredRotation = target.y > tankPosition.y ? 270 : 90;
      }

      if (desiredRotation !== null && tankRotation !== desiredRotation) {
        turnToward(desiredRotation);
      } else if (linedUp) {
        shoot();
      }
    }
  }
}
`,
};

export default haddenTank;
