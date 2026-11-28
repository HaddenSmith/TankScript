interface TankScriptPosition {
  /** Horizontal arena position in grid cells. */
  readonly x: number;
  /** Vertical arena position in grid cells. */
  readonly y: number;
}

interface TankScriptArenaTank extends TankScriptPosition {
  /** Unique identifier for this tank. */
  readonly id: string | number;
  /** Display name of this tank. */
  readonly name: string;
  /** Current rotation or direction of this tank. */
  readonly rotation: number;
  /** Current health of this tank. */
  readonly health: number;
  /** Starting maximum health; hearts cannot heal above it. */
  readonly maxHealth: number;
  /** Speed of newly fired bullets, in cells per tick: 0.5 normally, 1 with Lightning. */
  readonly bulletSpeed: number;
  /** Remaining upgraded game ticks; zero when inactive. */
  readonly lightningTicksRemaining: number;
}

interface TankScriptBullet extends TankScriptPosition {
  /** Unique identifier for this bullet. */
  readonly id: string | number;
  /** Identifier of the tank that fired this bullet. */
  readonly ownerId: string | number;
  /** This bullet's captured speed; later Lightning changes do not affect it. */
  readonly speed: number;
  /** Current rotation or direction of this bullet. */
  readonly rotation: number;
}

interface TankScriptWall extends TankScriptPosition {
  readonly health: number;
  readonly maxHealth: number;
}

interface TankScriptPowerup extends TankScriptPosition {
  readonly type: 'heart' | 'lightning';
}

/** Unique identifier of the player's own tank. */
declare const tankId: string | number;

/**
 * Submit a command to move the player's tank up one step.
 * Only the first action called during a tick is recorded; later calls are ignored.
 */
declare function moveUp(): void;

/**
 * Submit a command to move the player's tank down one step.
 * Only the first action called during a tick is recorded; later calls are ignored.
 */
declare function moveDown(): void;

/**
 * Submit a command to move the player's tank left one step.
 * Only the first action called during a tick is recorded; later calls are ignored.
 */
declare function moveLeft(): void;

/**
 * Submit a command to move the player's tank right one step.
 * Only the first action called during a tick is recorded; later calls are ignored.
 */
declare function moveRight(): void;

/**
 * Submit a command to rotate the player's tank left one step.
 * Only the first action called during a tick is recorded; later calls are ignored.
 */
declare function rotateLeft(): void;

/**
 * Submit a command to rotate the player's tank right one step.
 * Only the first action called during a tick is recorded; later calls are ignored.
 */
declare function rotateRight(): void;

/**
 * Submit a command to fire the player's tank weapon.
 * Only the first action called during a tick is recorded; later calls are ignored.
 */
declare function shoot(): void;

/** Read-only arena position of the player's own tank. */
declare const tankPosition: Readonly<TankScriptPosition>;

/** Read-only current rotation or direction of the player's own tank. */
declare const tankRotation: number;

/** Read-only current health of the player's own tank. */
declare const tankHealth: number;

/** Maximum health of your tank. Hearts restore 1 HP up to this value. */
declare const tankMaxHealth: number;

/** Speed of your next shot: 0.5 cells per tick normally, 1 while Lightning is active. */
declare const tankBulletSpeed: number;

/** Lightning collected on tick N boosts ticks N+1 through N+50. Recollection resets to 50. */
declare const tankLightningTicksRemaining: number;

/** Read-only information about every tank currently in the arena. */
declare const allTanks: ReadonlyArray<Readonly<TankScriptArenaTank>>;

/** Read-only snapshots of every bullet currently in the arena. */
declare const allBullets: ReadonlyArray<Readonly<TankScriptBullet>>;

/** Living destructible walls only; destroyed walls are no longer obstacles. */
declare const allWalls: ReadonlyArray<Readonly<TankScriptWall>>;

/** Visible, uncollected hearts and lightning pickups. */
declare const allPowerups: ReadonlyArray<Readonly<TankScriptPowerup>>;

/** Current width of the arena in grid cells. */
declare const arenaWidth: number;

/** Current height of the arena in grid cells. */
declare const arenaHeight: number;
