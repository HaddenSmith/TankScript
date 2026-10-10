import { BattleEngine } from '../game/engine/battleEngine';
import { Tank } from '../game/engine/tank.js';
import { dumbTank } from '../game/practiceTanks/dumbTank.js'

// UI-to-engine boundary. Keep game rules in the engine, not in React.
export function createBattleFromSelectedTanks(playerTank, opponentTank, arenaSize) {
  const battleEngine = new BattleEngine(arenaSize, arenaSize);

  // battleEngine.addTank(playerTank);
  // battleEngine.addTank(opponentTank);
  const practiceTank1 = new Tank(1, 'practiceTank1', 2, 2, dumbTank);
  const practiceTank2 = new Tank(2, 'practiceTank1', 10, 10, dumbTank);
  battleEngine.addTank(practiceTank1);
  battleEngine.addTank(practiceTank2);

  return battleEngine;
}
