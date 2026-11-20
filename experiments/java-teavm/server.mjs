import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('.', import.meta.url));
const files = new Set(['index.html', 'app.js', 'experiment.css', 'session.js', 'worker.js', 'frame.html', 'frame.js', 'tanks.js', 'cheerpj-tanks.js', 'asset-lock.json',
  'NOTICE.md', 'licenses/Apache-2.0.txt', 'licenses/TeaVM-NOTICE.txt', 'licenses/ASM-BSD.txt', 'licenses/JZlib-BSD.txt',
  'licenses/OpenJDK-GPL-2.0-with-classpath-exception.txt', 'licenses/OpenJDK-ADDITIONAL_LICENSE_INFO.txt',
  'licenses/Unicode-CLDR-37.txt',
  'generated/asset-manifest.json', 'generated/csp-runtime-manifest.json', 'generated/assets/compiler.wasm', 'generated/assets/compiler.wasm-runtime.js', 'generated/assets/compiler.csp-runtime.js',
  'generated/assets/compile-classlib-teavm.bin', 'generated/assets/runtime-classlib-teavm.bin']);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.md':'text/plain', '.txt':'text/plain' };

export async function startExperiment() {
  const hits = [];
  let appOrigin;
  let executionOrigin;
  function handler(kind) {
    return async (request, response) => {
      const url = new URL(request.url, 'http://experiment.invalid');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      if (url.pathname === '/probe' || url.pathname === '/private/account') {
        const cookies = (request.headers.cookie ?? '').split(';').map(cookie => cookie.trim());
        const hasDummySession = cookies.includes('teavm_session=dummy-only');
        hits.push({ server: kind, path: url.pathname, method: request.method, hasDummySession,
          hasDummyVisibleCookie: cookies.includes('teavm_visible=dummy-cookie'), origin: request.headers.origin ?? '' });
        response.writeHead(kind === 'app' && hasDummySession ? 200 : 403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(kind === 'app' && hasDummySession ? { canary: 'dummy-authenticated-account' } : { error: 'No dummy session' }));
        return;
      }
      if (url.pathname === '/config' && kind === 'app') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ appOrigin, executionOrigin })); return;
      }
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!files.has(name) || (kind !== 'app' && !['frame.html','frame.js'].includes(name))) { response.writeHead(404); response.end('Not found'); return; }
      try {
        let body = await readFile(path.join(root, name === 'cheerpj-tanks.js' ? '../java-cheerpj/tanks.js' : name));
        const nonce = randomUUID();
        if (name === 'frame.html') body = Buffer.from(body.toString().replace('__NONCE__', nonce));
        const policy = name === 'frame.html'
          ? `default-src 'none'; script-src 'nonce-${nonce}' blob:${url.searchParams.get('wasm') === '0' ? '' : " 'wasm-unsafe-eval'"}; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
          : `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src ${executionOrigin}; object-src 'none'; base-uri 'none'; form-action 'none'`;
        response.setHeader('Content-Security-Policy', policy);
        response.setHeader('Content-Type', types[path.extname(name)] ?? 'application/octet-stream');
        response.setHeader('Cache-Control', name.startsWith('generated/assets/') ? 'public, max-age=3600' : 'no-store');
        if (name === 'index.html') response.setHeader('Set-Cookie', [
          'teavm_session=dummy-only; HttpOnly; SameSite=Strict; Path=/',
          'teavm_visible=dummy-cookie; SameSite=Strict; Path=/',
        ]);
        response.end(body);
      } catch (error) { response.writeHead(500); response.end('Run setup.ps1 first: ' + error.code); }
    };
  }
  const app = http.createServer(handler('app'));
  const execution = http.createServer(handler('execution'));
  for (const [kind, server] of [['app',app],['execution',execution]]) server.on('upgrade', (request,socket) => {
    hits.push({ server: kind, path: new URL(request.url,'http://experiment.invalid').pathname, method: 'UPGRADE' });
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  const listen = (server, host) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); });
  await listen(app, '127.0.0.1'); await listen(execution, '127.0.0.2');
  appOrigin = 'http://127.0.0.1:' + app.address().port;
  executionOrigin = 'http://127.0.0.2:' + execution.address().port;
  return { appOrigin, executionOrigin, hits, async close() {
    await Promise.all([app, execution].map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
  } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const servers = await startExperiment();
  console.log('TeaVM experiment: ' + servers.appOrigin);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await servers.close(); process.exit(0); });
}
