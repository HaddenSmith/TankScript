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
  );
}