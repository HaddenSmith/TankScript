import { TANK_SCRIPT_ACTIONS } from '../../game/tank-script/shared/tankScriptRunnerProtocol.js';

export function pythonApiName(name) {
  return name.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
}

const stateNames = [
  'tank_id', 'tank_position', 'tank_rotation', 'tank_health',
  'all_tanks', 'all_bullets', 'arena_width', 'arena_height',
  'all_walls', 'all_powerups', 'tank_max_health', 'tank_bullet_speed', 'tank_lightning_ticks_remaining',
];
const recordFields = ['id', 'name', 'x', 'y', 'rotation', 'health', 'owner_id', 'max_health', 'bullet_speed', 'lightning_ticks_remaining', 'speed', 'type'];

export function registerPythonTankCompletions(monaco) {
  return monaco.languages.registerCompletionItemProvider('python', {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn,
      };
      const beforeCursor = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const fields = /\.\w*$/.test(beforeCursor);
      const suggestions = (fields ? recordFields : stateNames).map(name => ({
        label: name,
        insertText: name,
        kind: fields ? monaco.languages.CompletionItemKind.Field : monaco.languages.CompletionItemKind.Variable,
        detail: 'Read-only TankScript state',
        range,
      }));
      if (!fields) {
        for (const action of TANK_SCRIPT_ACTIONS) {
          const name = pythonApiName(action);
          suggestions.push({
            label: name, insertText: name + '()',
            kind: monaco.languages.CompletionItemKind.Function,
            documentation: 'Submit a tank action. Only the first action in a tick is used.',
            range,
          });
        }
      }
      return { suggestions };
    },
  });
}
