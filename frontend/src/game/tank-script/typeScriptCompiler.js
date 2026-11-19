import ts from 'typescript';

// The browser worker supplies the bundled standard library and TankScript API.
export function compileTypeScript(source, definitions, libraries) {
  const sourceFile = ts.createSourceFile('tank.ts', source, ts.ScriptTarget.ES2020, true);
  const standaloneMessage = 'Use a standalone tank script. Imports, exports, modules, and reference directives are not supported.';
  const unsupported = [];
  if (ts.isExternalModule(sourceFile) || sourceFile.referencedFiles.length ||
      sourceFile.typeReferenceDirectives.length || sourceFile.libReferenceDirectives.length ||
      sourceFile.hasNoDefaultLib) {
    unsupported.push({ line: 1, column: 1, message: standaloneMessage });
  }
  function checkNode(node) {
    if (ts.isImportTypeNode(node) || ts.isModuleDeclaration(node) ||
        (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      unsupported.push({ line: position.line + 1, column: position.character + 1, message: standaloneMessage });
    }
    ts.forEachChild(node, checkNode);
  }
  checkNode(sourceFile);
  if (unsupported.length) return { diagnostics: unsupported.slice(0, 10) };

  const files = { ...libraries, 'tank.ts': source, 'tankScript.d.ts': definitions };
  const sourceFiles = new Map([['tank.ts', sourceFile]]);
  const fileNameOnly = (name) => name.split('/').pop();
  let javascript = '';
  const host = {
    getSourceFile(name, target) {
      const key = fileNameOnly(name);
      if (!Object.hasOwn(files, key)) return undefined;
      if (!sourceFiles.has(key)) sourceFiles.set(key, ts.createSourceFile(key, files[key], target, true));
      return sourceFiles.get(key);
    },
    getDefaultLibFileName: () => 'lib.es2020.d.ts',
    writeFile(name, text) {
      if (name.endsWith('tank.js')) javascript = text;
    },
    getCurrentDirectory: () => '',
    getDirectories: () => [],
    fileExists: (name) => Object.hasOwn(files, fileNameOnly(name)),
    readFile: (name) => files[fileNameOnly(name)],
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const program = ts.createProgram(['tank.ts', 'tankScript.d.ts'], {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ES2020,
    lib: ['lib.es2020.d.ts'],
    strict: true,
    skipLibCheck: true,
  }, host);
  const diagnostics = [];
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    // QuickJS executes a function body, where an early return is valid.
    if (diagnostic.category !== ts.DiagnosticCategory.Error || diagnostic.code === 1108) continue;
    const position = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    diagnostics.push({
      line: position ? position.line + 1 : undefined,
      column: position ? position.character + 1 : undefined,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    });
    if (diagnostics.length === 10) break;
  }
  if (diagnostics.length) return { diagnostics };

  program.emit(sourceFile);
  return { javascript, diagnostics: [] };
}
