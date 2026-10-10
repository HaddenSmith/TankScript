const mediumTank = {
  id: 'medium',
  name: 'Medium Tank',
  code: `
const opponents = allTanks.filter((tank) => tank.id !== tankId && tank.health > 0);
const opponent = opponents.reduce((closest, tank) => {
  if (!closest) return tank;
  const distance = Math.hypot(tank.x - tankPosition.x, tank.y - tankPosition.y);
  const closestDistance = Math.hypot(closest.x - tankPosition.x, closest.y - tankPosition.y);
  return distance < closestDistance ? tank : closest;
}, null);

const incomingBullet = allBullets.find((bullet) => {
  if (bullet.ownerId === tankId) return false;
  if (bullet.rotation === 0) return bullet.y === tankPosition.y && bullet.x < tankPosition.x;
  if (bullet.rotation === 90) return bullet.x === tankPosition.x && bullet.y > tankPosition.y;
  if (bullet.rotation === 180) return bullet.y === tankPosition.y && bullet.x > tankPosition.x;
  if (bullet.rotation === 270) return bullet.x === tankPosition.x && bullet.y < tankPosition.y;
  return false;
});

if (incomingBullet && Math.hypot(incomingBullet.x - tankPosition.x, incomingBullet.y - tankPosition.y) <= 2) {
  if (incomingBullet.rotation === 0 || incomingBullet.rotation === 180) {
    if (tankPosition.y > 0) moveUp();
    else if (tankPosition.y < arenaHeight - 1) moveDown();
  } else if (tankPosition.x < arenaWidth - 1) {
    moveRight();
  } else if (tankPosition.x > 0) {
    moveLeft();
  }
} else if (opponent) {
  const dx = opponent.x - tankPosition.x;
  const dy = opponent.y - tankPosition.y;
  const sameRow = dy === 0;
  const sameColumn = dx === 0;

  if (sameRow || sameColumn) {
    let desiredRotation;
    if (sameRow) desiredRotation = dx > 0 ? 0 : 180;
    else desiredRotation = dy < 0 ? 90 : 270;

    if (tankRotation !== desiredRotation) {
      const turn = (desiredRotation - tankRotation + 360) % 360;
      if (turn === 90) rotateLeft();
      else if (turn === 270) rotateRight();
      else rotateLeft();
    } else {
      shoot();
    }
  } else if (Math.abs(dx) > Math.abs(dy)) {
    if (dy < 0) moveUp();
    else moveDown();
  } else if (dx < 0) {
    moveLeft();
  } else {
    moveRight();
  }
}
`,
};

export default mediumTank;
