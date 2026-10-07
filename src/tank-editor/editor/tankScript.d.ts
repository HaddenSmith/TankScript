interface TankScriptPosition {
  /** Horizontal position of the tank in the arena. */
  readonly x: number;
  /** Vertical position of the tank in the arena. */
  readonly y: number;
}

interface TankScriptArenaTank extends TankScriptPosition {
  /** Unique identifier for this tank. */
  readonly id: string;
  /** Display name of this tank's player. */
  readonly name: string;
  /** Current rotation or direction of this tank. */
  readonly rotation: number;
  /** Current health of this tank. */
  readonly health: number;
  /**
   * Whether this tank is an enemy of the player.
   * In free-for-all battles, every other tank is an enemy.
   */
  readonly isEnemy: boolean;
}

/**
 * Submit a command to move the player's tank forward one step.
 * Only the first action called during a tick is recorded; later calls are ignored.
 */
declare function move(): void;

/**
 * Submit a command to move the player's tank backward one step.
 * Only the first action called during a tick is recorded; later calls are ignored.
 */
declare function moveBackward(): void;

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

/** Read-only information about every tank currently in the arena. */
declare const tankPositions: ReadonlyArray<Readonly<TankScriptArenaTank>>;
