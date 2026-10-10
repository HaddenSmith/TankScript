import { BattleEngine } from '../game/engine/battleEngine';
import { Tank } from '../game/engine/tank.js';

// UI-to-engine boundary. Keep game rules in the engine, not in React.
export function createBattleFromSelectedTanks(
  playerTank,
  opponentTank,
  arenaSize,
  startingHealth = 3,
) {
  const battleEngine = new BattleEngine(arenaSize, arenaSize);

  const playerRuntimeTank = new Tank(
    1,
    playerTank.name,
    1,
    Math.floor(arenaSize / 2),
    playerTank.code,
    startingHealth,
  );

  const opponentRuntimeTank = new Tank(
    2,
    opponentTank.name,
    arenaSize - 2,
    Math.floor(arenaSize / 2),
    opponentTank.code,
    startingHealth,
  );

  battleEngine.addTank(playerRuntimeTank);
  battleEngine.addTank(opponentRuntimeTank);

  return battleEngine;
}
