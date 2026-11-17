import { BattleEngine } from './engine/battleEngine.js';
import { Tank } from './engine/tank.js';

export const MIN_ARENA_SIZE = 8;
export const MAX_ARENA_SIZE = 20;
export const BATTLE_SPEED_OPTIONS = Object.freeze([0.125, 0.25, 0.5, 0.75, 1]);

export function maxBattleParticipants(arenaSize) {
  return Math.min(12, Math.floor(arenaSize / 2) + 2);
}

function getStartingPosition(participantIndex, participantCount, arenaSize) {
  const columnCount = Math.ceil(Math.sqrt(participantCount));
  const rowCount = Math.ceil(participantCount / columnCount);
  const column = participantIndex % columnCount;
  const row = Math.floor(participantIndex / columnCount);
  const spacing = arenaSize - 3;

  return {
    x: columnCount === 1
      ? Math.floor(arenaSize / 2)
      : 1 + Math.round((column / (columnCount - 1)) * spacing),
    y: rowCount === 1
      ? Math.floor(arenaSize / 2)
      : 1 + Math.round((row / (rowCount - 1)) * spacing),
  };
}

// Use the same starting positions for the Battle page and benchmarks.
export function createBattleFromSelectedTanks(
  participants,
  arenaSize,
  startingHealth = 3,
) {
  const battleEngine = new BattleEngine(arenaSize, arenaSize);

  participants.forEach((participant, index) => {
    const position = getStartingPosition(index, participants.length, arenaSize);
    const sourceTankId = participant.id;
    const runtimeTank = new Tank(
      index + 1,
      participant.name,
      position.x,
      position.y,
      participant.code,
      startingHealth,
      participant.color,
      sourceTankId,
    );

    battleEngine.addTank(runtimeTank);
  });

  return battleEngine;
}
