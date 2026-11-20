import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const stockFile = new URL('./generated/assets/compiler.wasm-runtime.js', import.meta.url);
const outputFile = new URL('./generated/assets/compiler.csp-runtime.js', import.meta.url);
const stock = await readFile(stockFile, 'utf8');
const stockHash = createHash('sha256').update(stock).digest('hex');
assert.equal(stockHash, 'd4fc035b410f444f79f49e3890643b8bfd644a02dcfc597e3fcaa8a07bafca08', 'Review patch before changing TeaVM runtime version');

// Exact positions are found with the existing TypeScript parser, not regex or browser evaluation.
// The hash and expected constructor list make an upstream change fail closed.
const replacements = [
  ['"return "+e+";"', '(() => cspGetGlobal(e))'],
  ['"value",e+" = value;"', '((value) => cspSetGlobal(e, value))'],
  ['"rethrowJavaAsJs","fn",`return function(${o})', '((rethrow, fn) => cspExportFunction(fn, e, rethrow))'],
  ['"constructor",`return function ${e}', '((constructor) => cspConstructor(e, constructor))'],
  ['"rethrowJavaAsJs","fn",`return function(${s})', '((rethrow, fn) => cspExportFunction(fn, r, rethrow, true))'],
  ['"wrapCallFromJavaToJs",...C,"body",', 'cspFunctionBody'],
  ['"rethrowJsAsJava","fn",...C,', '((rethrow, fn, ...args) => cspCallFunction(e, rethrow, fn, ...args))'],
  ['"rethrowJsAsJava","getGlobalName","instance","method",...C,', '((rethrow, getGlobal, instance, method, ...args) => cspCallMethod(e, rethrow, getGlobal, instance, method, ...args))'],
  ['"rethrowJsAsJava","constructor",...C,', '((rethrow, constructor, ...args) => cspConstruct(e, rethrow, constructor, ...args))'],
  ['...C,"return ["+F+"]"', '((...args) => cspArray(e, ...args))'],
];
const source = ts.createSourceFile('stock.js', stock, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const edits = [];
function collect(node) {
  if (ts.isNewExpression(node) && node.expression.getText(source) === 'Function') {
    const [prefix, replacement] = replacements[edits.length] ?? [];
    assert.ok(prefix && node.getText(source).startsWith('new Function(' + prefix), 'Unexpected runtime code generation site');
    edits.push({ start: node.getStart(source), end: node.end, replacement });
  }
  ts.forEachChild(node, collect);
}
collect(source);
assert.equal(edits.length, replacements.length, 'Unexpected runtime code generation count');
let patched = stock;
for (const edit of edits.reverse()) patched = patched.slice(0, edit.start) + edit.replacement + patched.slice(edit.end);
const support = await readFile(new URL('./csp-runtime-support.js', import.meta.url), 'utf8');
const result = `/* TeaVM 0.16.0, copyright Alexey Andreev and contributors, Apache-2.0.
 * Modified for this TankScript experiment: static wrappers and fixed JSBody helpers.
 * See prepare-csp-runtime.mjs, NOTICE.md and licenses/Apache-2.0.txt. */\n${support}\n${patched}\n`;
const output = ts.createSourceFile('csp.js', result, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(output.parseDiagnostics.length, 0, 'Invalid patched JavaScript');
function rejectDynamicCode(node) {
  if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && ['Function','eval'].includes(node.expression.getText(output))) {
    throw new Error('Dynamic JavaScript evaluation survived the patch');
  }
  ts.forEachChild(node, rejectDynamicCode);
}
rejectDynamicCode(output);
await writeFile(outputFile, result);
const metadata = { stockHash, patchedHash: createHash('sha256').update(result).digest('hex'),
  supportHash: createHash('sha256').update(support).digest('hex'),
  prepareScriptHash: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  replacementCount: edits.length };
await writeFile(new URL('./generated/csp-runtime-manifest.json', import.meta.url), JSON.stringify(metadata, null, 2) + '\n');
console.log('Prepared CSP runtime:', metadata);

// Inventory only the pinned compiler's helpers. Player source never runs in Node.
if (process.argv.includes('--inventory')) {
  const { load } = await import(stockFile.href);
  const definitions = [];
  await load(new Uint8Array(await readFile(new URL('./generated/assets/compiler.wasm', import.meta.url))), {
    noAutoImports: true,
    installImports(host) {
      for (let count = 0; count < 32; count++) {
        const name = 'createFunction' + count;
        const original = host.teavmJso[name];
        host.teavmJso[name] = (...args) => { definitions.push(args); return original(...args); };
      }
    },
  });
  await writeFile(new URL('./generated/compiler-js-bodies.json', import.meta.url), JSON.stringify(definitions, null, 2) + '\n');
  console.log('Trusted compiler requested', definitions.length, 'JSBody helpers during initialization.');
}
