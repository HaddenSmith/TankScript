export class Wall {
    constructor(x, y, health = 10) {
        this.x = x;
        this.y = y;
        this.health = health;
        this.maxHealth = health;
    }

    isDestroyed() { return this.health <= 0; }

    takeDamage(damage = 1) { this.health = Math.max(0, this.health - damage); }
}
