const easyTank = {
  id: 'easy',
  name: 'Easy Tank',
  code: `
const opponent = allTanks.find((tank) => tank.id !== tankId && tank.health > 0);

if (opponent) {
  const sameRow = opponent.y === tankPosition.y;
  const sameColumn = opponent.x === tankPosition.x;

  if (sameRow && tankPosition.x < opponent.x && tankRotation === 0) {
    shoot();
  } else if (sameRow && tankPosition.x > opponent.x && tankRotation === 180) {
    shoot();
  } else if (sameColumn && tankPosition.y > opponent.y && tankRotation === 90) {
    shoot();
  } else if (sameColumn && tankPosition.y < opponent.y && tankRotation === 270) {
    shoot();
  } else if (Math.abs(opponent.x - tankPosition.x) >= Math.abs(opponent.y - tankPosition.y)) {
    if (opponent.x > tankPosition.x) {
      if (tankRotation !== 0) rotateRight();
      else moveRight();
    } else {
      if (tankRotation !== 180) rotateLeft();
      else moveLeft();
    }
  } else if (opponent.y > tankPosition.y) {
    if (tankRotation !== 270) rotateRight();
    else moveDown();
  } else {
    if (tankRotation !== 90) rotateLeft();
    else moveUp();
  }
}
`,
};

export default easyTank;
