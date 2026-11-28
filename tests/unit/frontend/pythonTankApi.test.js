import { describe, expect, jest, test } from '@jest/globals';
import { registerPythonTankCompletions } from '../../../frontend/src/tank-editor/editor/pythonTankApi.js';
import { TANK_SCRIPT_ACTIONS } from '../../../frontend/src/game/tank-script/shared/tankScriptRunnerProtocol.js';

describe('Python API completions', () => {
  test('offers every engine action, Python state name, and record fields', () => {
    const register = jest.fn();
    registerPythonTankCompletions({ languages: {
      registerCompletionItemProvider: register,
      CompletionItemKind: { Function: 1, Variable: 2, Field: 3 },
    } });
    const provider = register.mock.calls[0][1];
    const model = { getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }), getLineContent: () => '' };
    const global = provider.provideCompletionItems(model, { lineNumber: 1, column: 1 }).suggestions;
    for (const action of TANK_SCRIPT_ACTIONS) {
      const name = action.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
      expect(global).toEqual(expect.arrayContaining([expect.objectContaining({ label: name, insertText: name + '()' })]));
    }
    expect(global.map(item => item.label)).toEqual(expect.arrayContaining([
      'tank_id', 'tank_position', 'tank_rotation', 'tank_health', 'all_tanks', 'all_bullets', 'arena_width', 'arena_height',
      'all_walls', 'all_powerups', 'tank_max_health', 'tank_bullet_speed', 'tank_lightning_ticks_remaining',
    ]));
    model.getLineContent = () => 'bullet.';
    const fields = provider.provideCompletionItems(model, { lineNumber: 1, column: 8 }).suggestions;
    expect(fields.map(item => item.label)).toEqual(expect.arrayContaining([
      'owner_id', 'x', 'y', 'health', 'max_health', 'bullet_speed', 'lightning_ticks_remaining', 'speed', 'type',
    ]));
  });
});
