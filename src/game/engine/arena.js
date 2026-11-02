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

  isTankOutOfBounds(tank) {
    return (
      tank.x < 0 ||
      tank.x >= this.width ||
      tank.y < 0 ||
      tank.y >= this.height
    );
  }

  isBulletOutOfBounds(bullet) {
    return (
      bullet.x < -0.5 ||
      bullet.x > this.width - 0.5 ||
      bullet.y < -0.5 ||
      bullet.y > this.height - 0.5
    );
  }
}