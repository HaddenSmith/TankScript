import { compileTypeScript } from './typeScriptCompiler.js';
import definitions from './tankScript.d.ts?raw';

const libraryFiles = import.meta.glob([
  '/node_modules/typescript/lib/lib.es5.d.ts',
  '/node_modules/typescript/lib/lib.es201[5-9]*.d.ts',
  '/node_modules/typescript/lib/lib.es2020*.d.ts',
  '/node_modules/typescript/lib/lib.decorators*.d.ts',
], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const libraries = {};
for (const [name, contents] of Object.entries(libraryFiles)) {
  libraries[name.split('/').pop()] = contents;
}

self.onmessage = ({ data }) => {
  try {
    self.postMessage(compileTypeScript(data.source, definitions, libraries));
  } catch {
    self.postMessage({ diagnostics: [{ message: 'TypeScript compilation failed. Simplify the code and try again.' }] });
  }
};
