// Builds only our trusted test bridge. Player source is compiled in the browser.
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('.', import.meta.url));
const classes = path.join(root, 'generated/classes');
mkdirSync(classes, { recursive: true });
const jdkBin = process.env.TANKSCRIPT_EXPERIMENT_JDK
  ? path.join(process.env.TANKSCRIPT_EXPERIMENT_JDK, 'bin')
  : process.platform === 'win32' && existsSync('C:/Program Files/Java/jdk-25/bin/javac.exe')
    ? 'C:/Program Files/Java/jdk-25/bin' : '';
const executable = name => jdkBin ? path.join(jdkBin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
execFileSync(executable('javac'), ['--release', '21', '-d', classes, path.join(root, 'java/ExperimentBridge.java')], { stdio: 'inherit', windowsHide: true });
execFileSync(executable('jar'), ['--create', '--file', path.join(root, 'generated/bridge.jar'), '-C', classes, '.'], { stdio: 'inherit', windowsHide: true });
console.log('Built the experiment bridge for Java 21. No player code was compiled.');
