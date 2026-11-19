const fs = require('node:fs');
const path = require('node:path');

function loadTypeScriptLibraries() {
  const directory = path.dirname(require.resolve('typescript'));
  const libraries = {};
  for (const name of fs.readdirSync(directory)) {
    if (name.startsWith('lib.es') || name.startsWith('lib.decorators')) {
      libraries[name] = fs.readFileSync(path.join(directory, name), 'utf8');
    }
  }
  const definitions = fs.readFileSync(path.join(__dirname, '../../frontend/src/game/tank-script/shared/tankScript.d.ts'), 'utf8');
  return { definitions, libraries };
}

module.exports = { loadTypeScriptLibraries };
