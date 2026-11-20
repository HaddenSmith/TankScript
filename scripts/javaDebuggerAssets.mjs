import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Serve the reviewed local experiment assets only while the development flag is enabled.
// No compiler binaries are copied into public/, bundled, downloaded, or rebuilt here.
export function javaDebuggerAssetsPlugin() {
  return {
    name: 'java-debugger-assets',
    async configureServer(server) {
      const manifest = JSON.parse(await readFile(new URL('../frontend/src/game/tank-script/java/javaToolchain.json', import.meta.url), 'utf8'));
      const assets = new Map();
      for (const [name, expected] of Object.entries(manifest.files)) {
        let bytes;
        try { bytes = await readFile(new URL('../experiments/java-teavm/generated/assets/' + name, import.meta.url)); }
        catch { throw new Error('Java Debugger assets are missing. Follow frontend/src/game/tank-script/java/README.md.'); }
        if (createHash('sha256').update(bytes).digest('hex') !== expected) {
          throw new Error('Java Debugger asset needs review: ' + name + '. Do not automatically replace the pinned hash.');
        }
        assets.set(name, bytes);
      }
      for (const name of ['NOTICE.md', 'licenses/Apache-2.0.txt', 'licenses/TeaVM-NOTICE.txt',
        'licenses/OpenJDK-GPL-2.0-with-classpath-exception.txt', 'licenses/OpenJDK-ADDITIONAL_LICENSE_INFO.txt',
        'licenses/ASM-BSD.txt', 'licenses/JZlib-BSD.txt', 'licenses/Unicode-CLDR-37.txt', 'licenses/OpenJDK-jopt-simple.md',
        'licenses/Rhino-MPL-2.0.txt', 'licenses/Rhino-third-party-notices.txt',
        'licenses/HPPC-0.10.0-LICENSE.txt', 'licenses/HPPC-third-party-notices.txt']) {
        assets.set(name, await readFile(new URL('../experiments/java-teavm/' + name, import.meta.url)));
      }
      server.middlewares.use('/__java-debugger__', (request, response) => {
        const name = new URL(request.url, 'http://local.invalid').pathname.slice(1);
        if (request.method !== 'GET' || !assets.has(name)) { response.writeHead(404); response.end(); return; }
        let contentType = 'text/plain';
        if (name.endsWith('.js')) contentType = 'text/javascript';
        if (name.endsWith('.wasm')) contentType = 'application/wasm';
        if (name.endsWith('.bin')) contentType = 'application/octet-stream';
        response.setHeader('Content-Type', contentType);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Cache-Control', 'no-store');
        response.end(assets.get(name));
      });
    },
  };
}
