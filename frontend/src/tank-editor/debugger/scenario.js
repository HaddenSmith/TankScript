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
    walls: [],
    hearts: [],
    lightnings: [],
  };
}

export function createDebuggerTankState(scenario) {
  const { tankId, allTanks, allBullets, arenaWidth, arenaHeight } = scenario;
  const tank = allTanks.find((tank) => tank.id === tankId);
  if (!tank) throw new Error('The player tank is missing from the scenario.');

  return {
    tankId,
    tankPosition: { x: tank.x, y: tank.y },
    tankRotation: tank.rotation,
    tankHealth: tank.health,
    allTanks,
    allBullets,
    arenaWidth,
    arenaHeight,
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
    !isPositionOccupiedByPowerup(scenario, x, y) &&
    !scenario.walls.some((wall) => wall.x === x && wall.y === y) &&
    !scenario.allTanks.some((tank) => (
      tank.id !== movingTankId && tank.x === x && tank.y === y
    ));
}

export function canPlaceDebuggerWall(scenario, x, y, movingWallId = null) {
  return isInsideDebuggerArena(scenario, x, y) &&
    !isPositionOccupiedByPowerup(scenario, x, y) &&
    !scenario.allTanks.some((tank) => tank.x === x && tank.y === y) &&
    !scenario.allBullets.some((bullet) => (
      Math.abs(bullet.x - x) < 0.5 && Math.abs(bullet.y - y) < 0.5
    )) &&
    !scenario.walls.some((wall) => (
      wall.id !== movingWallId && wall.x === x && wall.y === y
    ));
}

function isPositionOccupiedByPowerup(scenario, x, y, movingPowerupId = null) {
  return scenario.hearts.some(heart => heart.id !== movingPowerupId && heart.x === x && heart.y === y) ||
    scenario.lightnings.some(lightning => lightning.id !== movingPowerupId && lightning.x === x && lightning.y === y);
}

export function canPlaceDebuggerPowerup(scenario, x, y, movingPowerupId = null) {
  return isInsideDebuggerArena(scenario, x, y) &&
    !isPositionOccupiedByPowerup(scenario, x, y, movingPowerupId) &&
    !scenario.allTanks.some(tank => tank.x === x && tank.y === y) &&
    !scenario.walls.some(wall => wall.x === x && wall.y === y) &&
    !scenario.allBullets.some(bullet => Math.abs(bullet.x - x) <= 0.5 && Math.abs(bullet.y - y) <= 0.5);
}

export function canPlaceDebuggerBullet(scenario, x, y) {
  return Number.isInteger(x * 2) &&
    Number.isInteger(y * 2) &&
    (Number.isInteger(x) || Number.isInteger(y)) &&
    ![...scenario.hearts, ...scenario.lightnings].some(powerup => (
      Math.abs(powerup.x - x) <= 0.5 && Math.abs(powerup.y - y) <= 0.5
    )) &&
    x >= -0.5 &&
    x <= scenario.arenaWidth - 0.5 &&
    y >= -0.5 &&
    y <= scenario.arenaHeight - 0.5;
}
