import { TANK_SCRIPT_ACTIONS } from '../../game/tank-script/shared/tankScriptRunnerProtocol.js';

const snapshotMethods = ['tankId', 'tankPosition', 'tankRotation', 'tankHealth', 'allTanks', 'allBullets', 'arenaWidth', 'arenaHeight'];
const positionMethods = ['x', 'y'];
const tankMethods = ['id', 'name', 'x', 'y', 'rotation', 'health'];
const bulletMethods = ['id', 'ownerId', 'x', 'y', 'rotation'];

// API hints only: Monaco's basic Java mode is not a Java language server.
export function registerJavaTankCompletions(monaco) {
  return monaco.languages.registerCompletionItemProvider('java', {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn };
      const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      if (before.trimStart().startsWith('//')) return { suggestions: [] };
      const source = model.getValue();
      const signature = source.match(/\bvoid\s+tick\s*\(\s*(?:[\w.]+\.)?Snapshot\s+(\w+)\s*,\s*(?:[\w.]+\.)?TankScript\s+(\w+)/);
      const state = signature?.[1] ?? 'state';
      const api = signature?.[2] ?? 'api';
      const receiver = before.match(/([\w.()\[\]]+)\.\w*$/)?.[1];
      let methods = [];
      let description = 'Read-only TankScript record accessor';
      if (receiver === api) {
        methods = TANK_SCRIPT_ACTIONS;
        description = 'Submit an action. Only the first action in a tick is used.';
      } else if (receiver === state) {
        methods = snapshotMethods;
      } else if (receiver === state + '.tankPosition()') {
        methods = positionMethods;
      } else if (receiver?.startsWith(state + '.allTanks().get(')) {
        methods = tankMethods;
      } else if (receiver?.startsWith(state + '.allBullets().get(')) {
        methods = bulletMethods;
      } else if (receiver) {
        // Recognize the record variable in the starter's enhanced for-loop.
        const loops = source.matchAll(/for\s*\(\s*(?:var|[\w.]*Tank|[\w.]*Bullet)\s+(\w+)\s*:\s*(\w+)\.(allTanks|allBullets)\s*\(\s*\)/g);
        for (const loop of loops) {
          if (loop[1] === receiver && loop[2] === state) methods = loop[3] === 'allTanks' ? tankMethods : bulletMethods;
        }
      }
      if (!receiver) {
        return { suggestions: [
          ...TANK_SCRIPT_ACTIONS.map(name => ({name, prefix: api + '.', description: 'TankScript action; first action wins.'})),
          ...snapshotMethods.map(name => ({name, prefix: state + '.', description: 'Read-only TankScript snapshot'})),
        ].map(({name, prefix, description}) => ({ label: prefix + name + '()', insertText: prefix + name + '()',
          kind: monaco.languages.CompletionItemKind.Method, documentation: description, range })) };
      }
      return { suggestions: methods.map(name => ({label: name + '()', insertText: name + '()',
        kind: monaco.languages.CompletionItemKind.Method, documentation: description, range})) };
    },
  });
}
