import tankScriptDefinitions from './tankScript.d.ts?raw';

const definitionsUri = 'file:///tankscript/tankScript.d.ts';
let definitionsRegistration;

export function registerTankScriptDefinitions(monaco) {
  // Monaco's JavaScript defaults are shared by editor instances, so register
  // this library once instead of adding a duplicate every time an editor mounts.
  if (definitionsRegistration) {
    return;
  }

  definitionsRegistration =
    monaco.languages.typescript.javascriptDefaults.addExtraLib(
      tankScriptDefinitions,
      definitionsUri,
    );
}
