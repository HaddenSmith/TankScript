import { describe, expect, test } from '@jest/globals';
import easy from '../../../src/game/builtInTanks/easyTank.js';
import medium from '../../../src/game/builtInTanks/mediumTank.js';
import hard from '../../../src/game/builtInTanks/hardTank.js';
import expert from '../../../src/game/builtInTanks/expertTank.js';
import overkill from '../../../src/game/builtInTanks/overkillTank.js';
import { createBattleFromSelectedTanks } from '../../../src/battle/battleController.js';
import { createTankScriptApi } from '../../../src/game/tank-script/tankScriptApi.js';
import { executeTankScript } from '../../../src/game/tank-script/tankScriptExecutor.js';

const officialTanks = [easy, medium, hard, expert, overkill];
const supportedActions = new Set([
  'moveUp', 'moveDown', 'moveLeft', 'moveRight',
  'rotateLeft', 'rotateRight', 'shoot',
]);

describe('official built-in tanks', () => {
  test('Overkill beats Expert in seeded seven-Easy matches', () => {
    const originalRandom = Math.random;
    const outcomes = { overkill: [], expert: [] };

    try {
      for (const [label, tank] of [['overkill', overkill], ['expert', expert]]) {
        for (const initialSeed of [123456789, 987654321, 42, 1337, 20261106]) {
          let seed = initialSeed;
          Math.random = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
          };
          const participants = [tank, ...Array.from({ length: 7 }, () => easy)];
          const engine = createBattleFromSelectedTanks(participants, 12, 3);
          let result = null;
          while (!result) result = engine.tick();
          outcomes[label].push({
            winner: result.winner?.id ?? 'tie',
            tickCount: result.tickCount,
          });
        }
      }
      const overkillWins = outcomes.overkill.filter((outcome) => outcome.winner === 1).length;
      const averageTicks = (matches) => (
        matches.reduce((total, outcome) => total + outcome.tickCount, 0) / matches.length
      );

      expect(overkillWins).toBeGreaterThanOrEqual(4);
      expect(averageTicks(outcomes.overkill)).toBeLessThan(averageTicks(outcomes.expert));
    } finally {
      Math.random = originalRandom;
    }
  });

  test('includes five official tanks in Easy-to-Overkill difficulty order', () => {
    expect(officialTanks.map((tank) => tank.difficulty)).toEqual([
      'easy', 'medium', 'hard', 'expert', 'overkill',
    ]);
    expect(officialTanks.map((tank) => tank.color)).toEqual([
      '#317d84', '#31834a', '#d97927', '#7952a3', '#b84579',
    ]);
  });

  test.each(officialTanks.map((tank) => [tank.name, tank]))(
    '%s runs with the existing TankScript API',
    (_name, tank) => {
      const api = createTankScriptApi();
      const state = {
        tankId: 1,
        tankPosition: { x: 2, y: 2 },
        tankRotation: 0,
        tankHealth: 3,
        allTanks: [
          { id: 1, name: tank.name, x: 2, y: 2, rotation: 0, health: 3 },
          { id: 2, name: 'Opponent', x: 5, y: 5, rotation: 180, health: 3 },
        ],
        allBullets: [],
        arenaWidth: 10,
        arenaHeight: 10,
      };

      expect(() => executeTankScript(tank.code, api, state)).not.toThrow();
      expect(supportedActions.has(api.getSubmittedCommand()?.action)).toBe(true);
    },
  );
});
