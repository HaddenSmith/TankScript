import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

for (const mixed of [false,true]) {
  test('Java stays disabled without the development flag, mixed battle: '+mixed,()=>{
    execFileSync(process.execPath,['--input-type=module','-e',`
      import assert from 'node:assert/strict';
      globalThis.__TANKSCRIPT_EXPERIMENTAL_JAVA__=false;
      const {JAVA_DEBUGGER_ENABLED}=await import('./frontend/src/game/tank-script/shared/tankScriptFeatures.js');
      assert.equal(JAVA_DEBUGGER_ENABLED,false);
      const {createTankScriptBattleRunner,createTankScriptWorkerRunner}=await import('./frontend/src/game/tank-script/shared/tankScriptWorkerRunner.js');
      const tanks=[{tankId:1,source:'class MyTank {}',language:'java'}];
      ${mixed ? "tanks.push({tankId:2,source:'shoot()',language:'python'});" : ''}
      await assert.rejects(createTankScriptBattleRunner(tanks),/only available in development/);
      await assert.rejects(createTankScriptWorkerRunner('class MyTank {}',{language:'java'}),/only available in development/);
    `],{cwd:new URL('../../../',import.meta.url),encoding:'utf8',windowsHide:true});
    assert.ok(true);
  });
}
