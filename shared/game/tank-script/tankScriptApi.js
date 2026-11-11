/**
 * Actions that a tank may submit during one game tick.
 *
 * @typedef {'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight' | 'rotateLeft' | 'rotateRight' | 'shoot'} TankScriptAction
 */

/**
 * The command recorded for a tank in a game tick.
 *
 * @typedef {Readonly<{ action: TankScriptAction }>} TankScriptCommand
 */

/**
 * The action functions exposed to one tank for one tick.
 *
 * @typedef {object} TankScriptTickApi
 * @property {() => void} moveUp
 * @property {() => void} moveDown
 * @property {() => void} moveLeft
 * @property {() => void} moveRight
 * @property {() => void} rotateLeft
 * @property {() => void} rotateRight
 * @property {() => void} shoot
 * @property {() => TankScriptCommand | undefined} getSubmittedCommand
 */

/**
 * Creates an API for collecting one tank's command during a single game tick.
 * Calling an action records it only if no earlier action has been submitted.
 * This does not stop script execution; it only ignores later action calls.
 *
 * The battle engine creates one API per tank per tick, evaluates each script
 * against the same arena state, then resolves all collected commands together.
 *
 * @returns {TankScriptTickApi}
 */
export function createTankScriptApi() {
  /** @type {TankScriptCommand | undefined} */
  let command;

  /**
   * Keep the first action submitted and ignore any later actions for this tick.
   *
   * @param {TankScriptAction} action
   */
  function submitAction(action) {
    if (command === undefined) {
      command = Object.freeze({ action });
    }
  }

  return Object.freeze({
    moveUp: () => submitAction('moveUp'),
    moveDown: () => submitAction('moveDown'),
    moveLeft: () => submitAction('moveLeft'),
    moveRight: () => submitAction('moveRight'),
    rotateLeft: () => submitAction('rotateLeft'),
    rotateRight: () => submitAction('rotateRight'),
    shoot: () => submitAction('shoot'),
    getSubmittedCommand: () => command,
  });
}
