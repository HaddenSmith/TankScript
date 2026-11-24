export class Wall {
    constructor(x, y, health = 5) {
        if (!Number.isFinite(health) || health < 0) {
            throw new RangeError('Wall health must be a non-negative finite number.');
        }
        this.x = x;
        this.y = y;
        this.health = health;
        this.maxHealth = health;
    }

    isDestroyed() { return this.health <= 0; }

    takeDamage(damage = 1) {
        if (!Number.isFinite(damage) || damage < 0) {
            throw new RangeError('Wall damage must be a non-negative finite number.');
        }
        this.health = Math.max(0, this.health - damage);
    }
}
