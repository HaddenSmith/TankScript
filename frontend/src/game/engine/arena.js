import { Wall } from './wall.js';

export class Arena {
  constructor(width, height, walls = false) {
    this.width = width;
    this.height = height;
    this.tanks = [];
    this.bullets = [];
    this.walls = walls ? this.#generateWalls() : [];
  }

  addTank(tank) {
    if (this.isPositionOccupiedByWall(tank.x, tank.y)) {
      throw new Error('Cannot place a tank inside a living wall.');
    }
    this.tanks.push(tank);
  }

  addBullet(bullet) { this.bullets.push(bullet); }

  addWall(wall) {
    if (!Number.isInteger(wall.x) || !Number.isInteger(wall.y) || this.isTankOutOfBounds(wall)) {
      throw new Error('Wall position must be an in-bounds grid cell.');
    }
    if (this.getWallByPosition(wall.x, wall.y)) {
      throw new Error('A wall already occupies this position.');
    }
    if (this.isPositionOccupiedByTank(wall.x, wall.y)) {
      throw new Error('Cannot place a wall on a tank.');
    }
    this.walls.push(wall);
  }

  generateWalls() { this.walls = this.#generateWalls(); }

  removeTank(tankId) { this.tanks = this.tanks.filter(tank => tank.id !== tankId); }

  removeBullet(bulletId) { this.bullets = this.bullets.filter(bullet => bullet.id !== bulletId); }

  getTankById(tankId) { return this.tanks.find(tank => tank.id === tankId); }

  getBulletById(bulletId) { return this.bullets.find(bullet => bullet.id === bulletId); }

  getWallByPosition(x, y) { return this.walls.find(wall => wall.x === x && wall.y === y); }

  getFirstWallInPath(start, end) {
    let closestWall;
    let closestDistance = Infinity;
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);

    for (const wall of this.walls) {
      if (wall.isDestroyed()) continue;
      // Walls fill a grid cell. Bullets move on one axis, so these ranges
      // cover the whole path, even when neither endpoint is at a cell center.
      if (maxX < wall.x - 0.5 || minX > wall.x + 0.5 ||
          maxY < wall.y - 0.5 || minY > wall.y + 0.5) continue;

      const distance = Math.max(0, Math.abs(wall.x - start.x) - 0.5)
        + Math.max(0, Math.abs(wall.y - start.y) - 0.5);
      if (distance > closestDistance) continue;
      // Shared edges use coordinate order, not insertion order, to break ties.
      if (distance === closestDistance && closestWall) {
        if (wall.x > closestWall.x) continue;
        if (wall.x === closestWall.x && wall.y >= closestWall.y) continue;
      }
      closestWall = wall;
      closestDistance = distance;
    }
    return closestWall;
  }

  isPositionOccupiedByTank(x, y) { return this.tanks.some(tank => tank.x === x && tank.y === y); }

  isPositionOccupiedByWall(x, y) { return this.walls.some(wall => wall.x === x && wall.y === y && !wall.isDestroyed()); }

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

  #generateWalls() {
    const middleX = (this.width - 1) / 2;
    const middleY = (this.height - 1) / 2;
    const available = new Map();
    const keyFor = (x, y) => `${x},${y}`;
    const neighborsOf = ({ x, y }) => [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ];

    for (let y = 1; y < this.height - 1; y += 1) {
      for (let x = 1; x < this.width - 1; x += 1) {
        const isCentralLane = Math.abs(x - middleX) < 1 || Math.abs(y - middleY) < 1;
        if (!isCentralLane && !this.isPositionOccupiedByTank(x, y)) {
          available.set(keyFor(x, y), { x, y });
        }
      }
    }

    const targetCount = Math.min(
      available.size,
      Math.max(2, Math.floor(available.size * 0.12)),
    );
    const walls = [];
    let remaining = targetCount;

    while (remaining >= 2) {
      const seeds = Array.from(available.values()).filter((cell) =>
        neighborsOf(cell).some((neighbor) => available.has(keyFor(neighbor.x, neighbor.y))),
      );
      if (seeds.length === 0) break;

      const seed = seeds[Math.floor(Math.random() * seeds.length)];
      const cluster = [seed];
      available.delete(keyFor(seed.x, seed.y));
      walls.push(new Wall(seed.x, seed.y));

      const clusterSize = Math.min(remaining, 2 + Math.floor(Math.random() * 4));
      while (cluster.length < clusterSize) {
        const frontier = new Map();
        for (const cell of cluster) {
          for (const neighbor of neighborsOf(cell)) {
            const key = keyFor(neighbor.x, neighbor.y);
            if (available.has(key)) frontier.set(key, neighbor);
          }
        }

        if (frontier.size === 0) break;

        const nextCell = Array.from(frontier.values())[
          Math.floor(Math.random() * frontier.size)
        ];
        available.delete(keyFor(nextCell.x, nextCell.y));
        cluster.push(nextCell);
        walls.push(new Wall(nextCell.x, nextCell.y));
      }

      remaining -= cluster.length;
    }

    return walls;
  }
}
