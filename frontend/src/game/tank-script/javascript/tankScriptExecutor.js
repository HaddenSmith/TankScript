import { TANK_SCRIPT_WORLD_STATE_NAMES } from '../shared/tankScriptSnapshot.js';

export function executeTankScript(code, api, state) {
  const names = [
    'moveUp',
    'moveDown',
    'moveLeft',
    'moveRight',
    'rotateLeft',
    'rotateRight',
    'shoot',
    'tankId',
    'tankPosition',
    'tankRotation',
    'tankHealth',
    'allTanks',
    'allBullets',
    'arenaWidth',
    'arenaHeight',
  ];
  const bindWorldState = new Function(
    ...TANK_SCRIPT_WORLD_STATE_NAMES,
    `return function(${names.join(',')}) {\n${code}\n};`,
  );
  const tankCode = bindWorldState(...TANK_SCRIPT_WORLD_STATE_NAMES.map(name => state[name]));

  tankCode(
    api.moveUp,
    api.moveDown,
    api.moveLeft,
    api.moveRight,
    api.rotateLeft,
    api.rotateRight,
    api.shoot,
    state.tankId,
    state.tankPosition,
    state.tankRotation,
    state.tankHealth,
    state.allTanks,
    state.allBullets,
    state.arenaWidth,
    state.arenaHeight,
  );
}

// SECURITY:
// This synchronous path is only for trusted fixtures and benchmarks.
// Public player code executes inside the isolated QuickJS/Pyodide workers.
