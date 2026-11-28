// Evaluation opponents only. These are not part of the application catalog.
export const officialTankBaselines = [
  { id: 'turret', name: 'Stationary turret baseline', color: '#667788', code: 'shoot();' },
  { id: 'pursuer', name: 'Greedy pursuit baseline', color: '#667788', code: `
const target = allTanks.find(tank => tank.id !== tankId && tank.health > 0);
if (!target) return;
const dx = target.x - tankPosition.x;
const dy = target.y - tankPosition.y;
if (dx === 0 || dy === 0) {
  const aim = dy === 0 ? (dx > 0 ? 0 : 180) : (dy < 0 ? 90 : 270);
  if (tankRotation === aim) shoot();
  else if ((aim - tankRotation + 360) % 360 === 270) rotateRight();
  else rotateLeft();
} else {
  const moves = [
    {x:Math.sign(dx),y:0,act:dx>0?moveRight:moveLeft},
    {x:0,y:Math.sign(dy),act:dy>0?moveDown:moveUp},
  ];
  const move = moves.find(move => {
    const x = tankPosition.x + move.x, y = tankPosition.y + move.y;
    return !allWalls.some(wall => wall.x === x && wall.y === y) &&
      !allTanks.some(tank => tank.id !== tankId && tank.x === x && tank.y === y);
  });
  if (move) move.act();
  else rotateLeft();
}
` },
];
