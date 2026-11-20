import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

for (const enabled of [false,true]) {
  test('Java battles are rejected with the Java development flag '+enabled,()=>{
    execFileSync(process.execPath,['--input-type=module','-e',`
      import assert from 'node:assert/strict';
      globalThis.__TANKSCRIPT_EXPERIMENTAL_JAVA__=${enabled};
      const {JAVA_DEBUGGER_ENABLED}=await import('./frontend/src/game/tank-script/shared/tankScriptFeatures.js');
      assert.equal(JAVA_DEBUGGER_ENABLED,${enabled});
      const {createTankScriptBattleRunner,createTankScriptWorkerRunner}=await import('./frontend/src/game/tank-script/shared/tankScriptWorkerRunner.js');
      await assert.rejects(createTankScriptBattleRunner([{tankId:1,source:'class MyTank {}',language:'java'}]),/Debugger only/);
      ${enabled ? '' : "await assert.rejects(createTankScriptWorkerRunner('class MyTank {}',{language:'java'}),/development Debugger/);"}
    `],{cwd:new URL('../../../',import.meta.url),encoding:'utf8',windowsHide:true});
    assert.ok(true);
  });
}
