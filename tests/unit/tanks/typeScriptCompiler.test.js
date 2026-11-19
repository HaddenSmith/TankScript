import starterTypeScriptCode from '../../../frontend/src/tank-editor/editor/starter-code/starterTypeScriptCode.js';
import { describe, expect, test } from '@jest/globals';
import { compileTypeScript } from '../../../frontend/src/game/tank-script/typescript/typeScriptCompiler.js';
import { loadTypeScriptLibraries } from '../../helpers/typeScriptLibraries.cjs';

const { definitions, libraries } = loadTypeScriptLibraries();
const compile = (source) => compileTypeScript(source, definitions, libraries);

describe('standalone TypeScript tank compiler', () => {
  test('compiles the actual TypeScript starter with the existing TankScript API', () => {
    const result = compile(starterTypeScriptCode);
    expect(result.diagnostics).toEqual([]);
    expect(result.javascript).toContain('shoot();');
    expect(result.javascript).not.toContain('Readonly<TankScriptArenaTank>');
  });

  test('supports standard JavaScript collections and emits TypeScript enums and classes', () => {
    const result = compile(`
      enum Direction { Right, Left }
      class Strategy { direction: Direction = Direction.Right; }
      const seen = new Set<number>([1]);
      const choices = new Map<string, number>([['right', 1]]);
      const enemy = allTanks.find(tank => tank.id !== tankId);
      const entries = Object.entries({ x: tankPosition.x });
      if (new Strategy().direction === Direction.Right && seen.has(1) && choices.size && entries.length && enemy) moveRight();
    `);
    expect(result.diagnostics).toEqual([]);
    expect(result.javascript).toContain('class Strategy');
    expect(result.javascript).not.toContain('enum Direction');
  });

  test('accepts early returns because tanks execute as function bodies', () => {
    expect(compile('if (tankHealth < 1) return; shoot();').diagnostics).toEqual([]);
  });

  test('reports source locations for syntax and type errors without executable output', () => {
    for (const source of ['const n: number = "wrong";', 'const n: = 2;', 'tankPosition.x = 2;', 'moveUp(3);']) {
      const result = compile(source);
      expect(result.javascript).toBeUndefined();
      expect(result.diagnostics[0]).toMatchObject({ line: 1, column: expect.any(Number), message: expect.any(String) });
    }
  });

  test.each([
    'import { x } from "external"; shoot();',
    'export const x = 1;',
    'export {};',
    'void import("external");',
    'type External = import("external").Tank;',
    'namespace External { export const x = 1; }',
    '/// <reference lib="dom" />\nshoot();',
    '/// <reference path="another.ts" />\nshoot();',
  ])('rejects imports, modules, and external references: %s', (source) => {
    const result = compile(source);
    expect(result.javascript).toBeUndefined();
    expect(result.diagnostics[0].message).toContain('standalone tank script');
  });

  test.each(['document.title = "unsafe";', 'process.exit();', 'require("fs");'])(
    'exposes the tank API and standard library without browser or Node globals: %s', (source) => {
      expect(compile(source).diagnostics[0].message).toMatch(/Cannot find name/);
    },
  );

  test('compiling never executes the source in the host', () => {
    const result = compile('(globalThis as any).__tankCompilerExecuted = true; shoot();');
    expect(result.diagnostics).toEqual([]);
    expect(globalThis.__tankCompilerExecuted).toBeUndefined();
  });
});
