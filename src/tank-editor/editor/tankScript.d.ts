interface TankScriptPosition {
  /** Horizontal position of the tank in the arena. */
  readonly x: number;
  /** Vertical position of the tank in the arena. */
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

/** Read-only information about every tank currently in the arena. */
declare const allTanks: ReadonlyArray<Readonly<TankScriptArenaTank>>;
