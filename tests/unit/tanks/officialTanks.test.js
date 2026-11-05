import { describe, expect, test } from '@jest/globals';
import easy from '../../../src/game/builtInTanks/easyTank.js';
import medium from '../../../src/game/builtInTanks/mediumTank.js';
import hard from '../../../src/game/builtInTanks/hardTank.js';
import expert from '../../../src/game/builtInTanks/expertTank.js';
import overkill from '../../../src/game/builtInTanks/overkillTank.js';
import { createTankScriptApi } from '../../../src/game/tank-script/tankScriptApi.js';
import { executeTankScript } from '../../../src/game/tank-script/tankScriptExecutor.js';

const officialTanks = [easy, medium, hard, expert, overkill];
const supportedActions = new Set([
  'moveUp', 'moveDown', 'moveLeft', 'moveRight',
  'rotateLeft', 'rotateRight', 'shoot',
]);

describe('official built-in tanks', () => {
  test('includes five official tanks in Easy-to-Overkill difficulty order', () => {
    expect(officialTanks.map((tank) => tank.difficulty)).toEqual([
      'easy', 'medium', 'hard', 'expert', 'overkill',
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
