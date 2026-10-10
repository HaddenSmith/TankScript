export function executeTankScript(code, api, state) {
  const tankCode = new Function(
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
    code,
  );

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
// TankScript currently runs as trusted JavaScript in the browser using
// new Function(). This is NOT a sandbox. Do not execute untrusted user code
// this way in a production or multi-user version.