import { Bullet } from './bullet.js';
import { DEFAULT_TANK_COLOR } from '../tankColors.js';
export class Tank {
  constructor(id, name, x, y, code, health = 3, color = DEFAULT_TANK_COLOR, sourceTankId = null) {
    this.id = id;
    this.sourceTankId = sourceTankId;
    this.name = name;
    this.x = x;
    this.y = y;
    this.rotation = 0;
    this.health = health;
    this.maxHealth = health;
    this.code = code;
    this.color = color;
    this.killCount = 0;
    this.damageDealt = 0;
    this.hasLightningPowerup = false;
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

    return new Bullet(bulletId, this.id, x, y, this.rotation, this.hasLightningPowerup ? 1 : 0.5);
  }

  isAlive() { return this.health > 0; }

  takeDamage(amount = 1) { this.health -= amount; }

  heal(amount = 1) { if (this.isAlive()) this.health = Math.min(this.maxHealth, this.health + amount); }

  addKill(amount = 1) { this.killCount += amount; }

  // Counts tank hits, including simultaneous overkill, rather than health removed.
  addDamageDealt(amount = 1) { this.damageDealt += amount; }

  lightningPowerup(status) { this.hasLightningPowerup = status; }
}