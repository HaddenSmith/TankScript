/**
 * Actions that a tank may submit during one game tick.
 *
 * @typedef {'rotateRight' | 'rotateLeft' | 'moveUp' | 'moveDown' | 'moveRight' | 'moveLeft' | 'shoot'} TankScriptAction
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
 * @property {() => void} rotateRight
 * @property {() => void} rotateLeft
 * @property {() => void} moveUp
 * @property {() => void} moveDown
 * @property {() => void} moveRight
 * @property {() => void} moveLeft
 * @property {() => void} shoot
 * @property {() => TankScriptCommand | undefined} getSubmittedCommand
 */

/**
 * Creates an API for collecting one tank's command during a single game tick.
 * Calling an action records it only if no earlier action has been submitted.
 * This does not stop script execution; it only ignores later action calls.
 *
 * The future battle engine will create one API per tank per tick, evaluate each
 * script against the same arena state, then resolve all collected commands
 * together before starting the next tick.
 *
 * @returns {TankScriptTickApi}
 */
export function createTickCommandApi() {
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
    rotateRight: () => submitAction('rotateRight'),
    rotateLeft: () => submitAction('rotateLeft'),
    moveUp: () => submitAction('moveUp'),
    moveDown: () => submitAction('moveDown'),
    moveRight: () => submitAction('moveRight'),
    moveLeft: () => submitAction('moveLeft'),
    shoot: () => submitAction('shoot'),
    getSubmittedCommand: () => command,
  });
}
