export class Bullet {
  constructor(id, ownerId, x, y, rotation) {
    this.id = id;
    this.ownerId = ownerId;
    this.x = x;
    this.y = y;
    this.rotation = rotation;
  }

  move() {
    if (this.rotation === 0) {
      this.x += .5;
    } else if (this.rotation === 90) {
      this.y -= .5;
    } else if (this.rotation === 180) {
      this.x -= .5;
    } else if (this.rotation === 270) {
      this.y += .5;  
    }
  }

  isCollidingWithTank(tank) { return this.x === tank.x && this.y === tank.y; }
}