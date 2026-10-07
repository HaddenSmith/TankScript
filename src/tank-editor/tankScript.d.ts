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
 * Move the player's tank forward one step.
 * During a game tick, only the first action function called counts as the
 * tank's submitted command.
 */
declare function move(): void;

/**
 * Move the player's tank backward one step.
 * During a game tick, only the first action function called counts as the
 * tank's submitted command.
 */
declare function moveBackward(): void;

/**
 * Rotate the player's tank left one step.
 * During a game tick, only the first action function called counts as the
 * tank's submitted command.
 */
declare function rotateLeft(): void;

/**
 * Rotate the player's tank right one step.
 * During a game tick, only the first action function called counts as the
 * tank's submitted command.
 */
declare function rotateRight(): void;

/**
 * Fire the player's tank weapon.
 * During a game tick, only the first action function called counts as the
 * tank's submitted command.
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
