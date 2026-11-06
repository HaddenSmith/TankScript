export const DEBUGGER_ARENA_WIDTH = 8;
export const DEBUGGER_ARENA_HEIGHT = 8;
export const PLAYER_TANK_ID = 0;

export function createDefaultDebuggerScenario(playerName = '') {
  return {
    tankId: PLAYER_TANK_ID,
    arenaWidth: DEBUGGER_ARENA_WIDTH,
    arenaHeight: DEBUGGER_ARENA_HEIGHT,
    allTanks: [
      {
        id: PLAYER_TANK_ID,
        name: playerName.trim() || 'Your Tank',
        x: 1,
        y: 1,
        rotation: 0,
        health: 3,
      },
      {
        id: 1,
        name: 'Dummy Tank',
        x: 6,
        y: 6,
        rotation: 180,
        health: 3,
      },
    ],
    allBullets: [],
  };
}

export function isInsideDebuggerArena(scenario, x, y) {
  return Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x < scenario.arenaWidth &&
    y >= 0 &&
    y < scenario.arenaHeight;
}

export function canPlaceDebuggerTank(scenario, x, y, movingTankId = null) {
  return isInsideDebuggerArena(scenario, x, y) &&
    !scenario.allTanks.some((tank) => (
      tank.id !== movingTankId && tank.x === x && tank.y === y
    ));
}

export function canPlaceDebuggerBullet(scenario, x, y) {
  return Number.isInteger(x * 2) &&
    Number.isInteger(y * 2) &&
    (Number.isInteger(x) || Number.isInteger(y)) &&
    x >= -0.5 &&
    x <= scenario.arenaWidth - 0.5 &&
    y >= -0.5 &&
    y <= scenario.arenaHeight - 0.5;
}
