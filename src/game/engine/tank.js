import { Bullet } from './bullet';
export class Tank {
  constructor(id, name, x, y, code, health = 3) {
    this.id = id;
    this.name = name;
    this.x = x;
    this.y = y;
    this.rotation = 0;
    this.health = health;
    this.code = code;
  }

  moveUp() { this.y--; }

  moveDown() { this.y++; }

  moveRight() { this.x++; }

  moveLeft() { this.x--; }

  rotateLeft() { this.rotation = (this.rotation + 90) % 360; }

  rotateRight() { this.rotation = (this.rotation + 270) % 360; }

  shoot(bulletId) {
    let x = this.x;
    let y = this.y;

    if (this.rotation === 0) {
      x += 0.5;
    } else if (this.rotation === 90) {
      y -= 0.5;
    } else if (this.rotation === 180) {
      x -= 0.5;
    } else if (this.rotation === 270) {
      y += 0.5;
    }

    return new Bullet(bulletId, this.id, x, y, this.rotation);
  }

  isAlive() { return this.health > 0; }

  takeDamage(amount = 1) { this.health -= amount; }
}