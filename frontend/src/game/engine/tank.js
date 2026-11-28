import { Bullet } from './bullet.js';
import { DEFAULT_TANK_COLOR } from '../tankColors.js';
export class Tank {
  static LIGHTNING_DURATION_TICKS = 30;

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
    this.lightningTicksRemaining = 0;
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

    return new Bullet(bulletId, this.id, x, y, this.rotation, this.bulletSpeed);
  }

  isAlive() { return this.health > 0; }

  takeDamage(amount = 1) {
    this.health -= amount;
    if (!this.isAlive()) this.lightningPowerup(false);
  }

  heal(amount = 1) { if (this.isAlive()) this.health = Math.min(this.maxHealth, this.health + amount); }

  addKill(amount = 1) { this.killCount += amount; }

  // Counts tank hits, including simultaneous overkill, rather than health removed.
  addDamageDealt(amount = 1) { this.damageDealt += amount; }

  get hasLightningPowerup() { return this.lightningTicksRemaining > 0; }

  get bulletSpeed() { return this.hasLightningPowerup ? 1 : 0.5; }

  lightningPowerup(status) { this.lightningTicksRemaining = (status && this.isAlive() ? Tank.LIGHTNING_DURATION_TICKS : 0); }

  advanceLightningTick() { if (this.lightningTicksRemaining > 0) this.lightningTicksRemaining--; }
}
