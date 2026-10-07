/**
 * Actions that a tank may submit during one game tick.
 *
 * @typedef {'move' | 'moveBackward' | 'rotateLeft' | 'rotateRight' | 'shoot'} TankScriptAction
 */

/**
 * The command recorded for a tank in a game tick.
 *
 * @typedef {Readonly<{ action: TankScriptAction }>} TankScriptCommand
 */

/**
 * The action functions eventually exposed to one tank's script for one tick.
 *
 * @typedef {object} TankScriptTickApi
 * @property {() => void} move
 * @property {() => void} moveBackward
 * @property {() => void} rotateLeft
 * @property {() => void} rotateRight
 * @property {() => void} shoot
 * @property {() => TankScriptCommand | undefined} getCommand
 */

/**
 * Creates an API for collecting one tank's command during a single game tick.
 * Calling an action records it only if no earlier action has been submitted.
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
    move: () => submitAction('move'),
    moveBackward: () => submitAction('moveBackward'),
    rotateLeft: () => submitAction('rotateLeft'),
    rotateRight: () => submitAction('rotateRight'),
    shoot: () => submitAction('shoot'),
    getCommand: () => command,
  });
}
