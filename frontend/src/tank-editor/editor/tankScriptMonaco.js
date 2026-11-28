import tankScriptDefinitions from '../../game/tank-script/shared/tankScript.d.ts?raw';
import { registerPythonTankCompletions } from './pythonTankApi.js';
import { registerJavaTankCompletions } from './javaTankApi.js';
import { JAVA_DEBUGGER_ENABLED } from '../../game/tank-script/shared/tankScriptFeatures.js';

const definitionsUri = 'file:///tankscript/tankScript.d.ts';
let definitionsRegistration;

export function registerTankScriptDefinitions(monaco) {
  // Monaco's language defaults are shared by editor instances, so register
  // this library once instead of adding a duplicate every time an editor mounts.
  if (definitionsRegistration) {
    return;
  }

  const typeScriptDefaults = monaco.typescript.typescriptDefaults;
  typeScriptDefaults.setCompilerOptions({
    target: monaco.typescript.ScriptTarget.ES2020,
    module: monaco.typescript.ModuleKind.ES2020,
    lib: ['lib.es2020.d.ts'],
    strict: true,
    // TypeScript's module-detection "force" value gives tank locals their own scope.
    moduleDetection: 3,
  });
  typeScriptDefaults.setDiagnosticsOptions({
    // TankScript is a function body at runtime, so early returns are valid.
    diagnosticCodesToIgnore: [1108],
  });
  definitionsRegistration = [
    registerPythonTankCompletions(monaco),
    monaco.typescript.javascriptDefaults.addExtraLib(
      tankScriptDefinitions,
      definitionsUri,
    ),
    typeScriptDefaults.addExtraLib(tankScriptDefinitions, definitionsUri),
  ];
  if (JAVA_DEBUGGER_ENABLED) definitionsRegistration.push(registerJavaTankCompletions(monaco));
}
