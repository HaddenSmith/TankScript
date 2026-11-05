import { describe, expect, test } from '@jest/globals';
import { createTankScriptApi } from '../../../src/game/tank-script/tankScriptApi.js';
import { executeTankScript } from '../../../src/game/tank-script/tankScriptExecutor.js';

const state = Object.freeze({
  tankId: 7,
  tankPosition: Object.freeze({ x: 2, y: 3 }),
  tankRotation: 90,
  tankHealth: 2,
  allTanks: Object.freeze([Object.freeze({ id: 7, x: 2, y: 3, health: 2 })]),
  allBullets: Object.freeze([]),
  arenaWidth: 10,
  arenaHeight: 10,
});

describe('TankScript executor', () => {
  test.each([
    'moveUp',
    'moveDown',
    'moveLeft',
    'moveRight',
    'rotateLeft',
    'rotateRight',
    'shoot',
  ])('executes the supported %s action', (action) => {
    const api = createTankScriptApi();
    executeTankScript(`${action}();`, api, state);

    expect(api.getSubmittedCommand()).toEqual({ action });
  });

  test('runs ordinary JavaScript and permits early returns', () => {
    const api = createTankScriptApi();
    executeTankScript('const target = allTanks.find(tank => tank.id === tankId); if (target) { moveUp(); return; } moveDown();', api, state);

    expect(api.getSubmittedCommand()).toEqual({ action: 'moveUp' });
  });

  test('keeps state snapshots read-only and does not mutate the source state', () => {
    const api = createTankScriptApi();

    expect(() => executeTankScript('"use strict"; tankPosition.x = 9;', api, state)).toThrow(TypeError);
    expect(state.tankPosition.x).toBe(2);
    expect(Object.isFrozen(state.allTanks[0])).toBe(true);
  });

  test('does not convert syntax or runtime errors into successful commands', () => {
    expect(() => executeTankScript('moveUp(', createTankScriptApi(), state)).toThrow(SyntaxError);
    expect(() => executeTankScript('throw new Error("script failed");', createTankScriptApi(), state))
      .toThrow('script failed');
  });

  test('collects only one action per API instance while allowing commands on later ticks', () => {
    const firstTickApi = createTankScriptApi();
    executeTankScript('moveUp(); moveRight();', firstTickApi, state);
    const secondTickApi = createTankScriptApi();
    executeTankScript('shoot();', secondTickApi, state);

    expect(firstTickApi.getSubmittedCommand()).toEqual({ action: 'moveUp' });
    expect(secondTickApi.getSubmittedCommand()).toEqual({ action: 'shoot' });
  });
});
