import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const lock = JSON.parse(await readFile(new URL('./asset-lock.json', import.meta.url), 'utf8'));
const manifestFile = new URL('./generated/asset-manifest.json', import.meta.url);
if (process.argv.includes('--record-build')) {
  const manifest = { ...lock, files: {} };
  for (const name of Object.keys(lock.files)) {
    manifest.files[name] = createHash('sha256').update(await readFile(new URL('./generated/assets/' + name, import.meta.url))).digest('hex');
  }
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
}
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
for (const [key,value] of Object.entries(lock)) if (key !== 'files') assert.deepEqual(manifest[key], value, key + ' pin');
for (const [name, expected] of Object.entries(lock.files)) {
  const bytes = await readFile(new URL('./generated/assets/' + name, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.files[name], name + ' checksum');
  if (manifest.files[name] !== expected) console.log(name + ': build fingerprint differs from reference; source and dependency versions remain pinned.');
}
if (!process.argv.includes('--record-build')) {
  const csp = JSON.parse(await readFile(new URL('./generated/csp-runtime-manifest.json', import.meta.url), 'utf8'));
  assert.equal(csp.stockHash, manifest.files['compiler.wasm-runtime.js']);
  for (const [file, expected] of [
    ['./generated/assets/compiler.csp-runtime.js', csp.patchedHash],
    ['./csp-runtime-support.js', csp.supportHash],
    ['./prepare-csp-runtime.mjs', csp.prepareScriptHash],
  ]) assert.equal(createHash('sha256').update(await readFile(new URL(file, import.meta.url))).digest('hex'), expected, file + ' CSP checksum');
}
console.log('Verified pinned compiler, runtime, and both class libraries.');
