export function dumbTank(api, state) {
  console.log('--- TankScript State ---');
  console.log('My ID:', state.tankId);
  console.log('My position:', state.tankPosition);
  console.log('My rotation:', state.tankRotation);
  console.log('My health:', state.tankHealth);
  console.log('All tanks:', state.tankPositions);

  const otherTank = state.tankPositions.find(
    (tank) => tank.id !== state.tankId
  );

  console.log('Other tank:', otherTank);

  if (otherTank) {
    api.moveRight();
  } else {
    api.rotateLeft();
  }
}