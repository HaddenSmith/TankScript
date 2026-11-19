import { describe, expect, jest, test } from '@jest/globals';
import { registerTankScriptDefinitions } from '../../../frontend/src/tank-editor/editor/tankScriptMonaco.js';

describe('TankScript Monaco definitions', () => {
  test('registers API types for both languages and configures only TypeScript defaults once', () => {
    const javascriptDefaults = { addExtraLib: jest.fn(), setCompilerOptions: jest.fn() };
    const typescriptDefaults = { addExtraLib: jest.fn(), setCompilerOptions: jest.fn(), setDiagnosticsOptions: jest.fn() };
    const monaco = { typescript: { javascriptDefaults, typescriptDefaults, ScriptTarget: { ES2020: 7 }, ModuleKind: { ES2020: 6 } } };
    monaco.languages = { registerCompletionItemProvider: jest.fn() };
    registerTankScriptDefinitions(monaco);
    registerTankScriptDefinitions(monaco);
    expect(javascriptDefaults.addExtraLib).toHaveBeenCalledTimes(1);
    expect(typescriptDefaults.addExtraLib).toHaveBeenCalledTimes(1);
    expect(typescriptDefaults.setCompilerOptions).toHaveBeenCalledWith({
      target: 7, module: 6, lib: ['lib.es2020.d.ts'], strict: true,
    });
    expect(typescriptDefaults.setDiagnosticsOptions).toHaveBeenCalledWith({ diagnosticCodesToIgnore: [1108] });
    expect(javascriptDefaults.setCompilerOptions).not.toHaveBeenCalled();
    expect(monaco.languages.registerCompletionItemProvider).toHaveBeenCalledTimes(1);
    expect(monaco.languages.registerCompletionItemProvider).toHaveBeenCalledWith('python', expect.any(Object));
  });
});
