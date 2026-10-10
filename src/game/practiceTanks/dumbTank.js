export function dumbTank(api, state) {

  const otherTank = state.tankPositions.find(
    (tank) => tank.id !== state.tankId
  );
  
  if (otherTank) {
    api.moveRight();
  } else {
    api.rotateLeft();
  }
}