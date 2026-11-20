import { expect, jest, test } from '@jest/globals';
import { registerJavaTankCompletions } from '../../../frontend/src/tank-editor/editor/javaTankApi.js';
import { TANK_SCRIPT_ACTIONS } from '../../../frontend/src/game/tank-script/shared/tankScriptRunnerProtocol.js';

function suggestions(line, source = '') {
  const register = jest.fn();
  registerJavaTankCompletions({languages:{registerCompletionItemProvider:register,CompletionItemKind:{Method:1}}});
  const model = {getValue:()=>source,getLineContent:()=>line,getWordUntilPosition:()=>({startColumn:line.length+1,endColumn:line.length+1})};
  return register.mock.calls[0][1].provideCompletionItems(model,{lineNumber:1,column:line.length+1}).suggestions;
}

test('Java actions match the seven engine actions and describe first-action-wins', () => {
  expect(suggestions('api.').map(item=>item.insertText)).toEqual(TANK_SCRIPT_ACTIONS.map(action=>action+'()'));
  expect(suggestions('api.')[0].documentation).toContain('first action');
});

test('Java suggestions use tick argument names, snapshot accessors and record fields', () => {
  const source='public void tick(TankScript.Snapshot snapshot, TankScript commands) { for(var enemy : snapshot.allTanks()) {} }';
  expect(suggestions('commands.',source).map(item=>item.label)).toContain('shoot()');
  expect(suggestions('snapshot.',source).map(item=>item.label)).toEqual(expect.arrayContaining(['tankId()','allTanks()','allBullets()','arenaWidth()']));
  expect(suggestions('snapshot.tankPosition().',source).map(item=>item.label)).toEqual(['x()','y()']);
  expect(suggestions('enemy.',source).map(item=>item.label)).toContain('health()');
  expect(suggestions('snapshot.allBullets().get(0).',source).map(item=>item.label)).toContain('ownerId()');
  expect(suggestions('unrelated.',source)).toEqual([]);
  expect(suggestions('// api.',source)).toEqual([]);
});
