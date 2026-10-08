export class Arena {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.tanks = [];
    this.bullets = [];
  }

  addTank(tank) { this.tanks.push(tank); }

  addBullet(bullet) { this.bullets.push(bullet); }

  removeTank(tankId) { this.tanks = this.tanks.filter(tank => tank.id !== tankId); }

  removeBullet(bulletId) { this.bullets = this.bullets.filter(bullet => bullet.id !== bulletId); }

  getTankById(tankId) { return this.tanks.find(tank => tank.id === tankId); }

  getBulletById(bulletId) { return this.bullets.find(bullet => bullet.id === bulletId); }

  isPositionOccupiedByTank(x, y) { return this.tanks.some(tank => tank.x === x && tank.y === y); }

  getTankAtPosition(x, y) { return this.tanks.find(tank => tank.x === x && tank.y === y); }

  isOutOfBounds(object) { // For both tanks and bullets
    return (
      object.x < 0 ||
      object.x >= this.width ||
      object.y < 0 ||
      object.y >= this.height
    );
  }
}