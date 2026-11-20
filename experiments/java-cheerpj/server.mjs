import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const files = new Set(['index.html', 'app.js', 'experiment.css', 'supervisor.js', 'frame.html', 'frame.js', 'worker.js', 'tanks.js', 'generated/bridge.jar']);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jar': 'application/java-archive' };

export async function startExperiment() {
  const hits = [];
  let appOrigin;
  let executionOrigin;
  function handler(kind) {
    return async (request, response) => {
      const url = new URL(request.url, 'http://experiment.invalid');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Cache-Control', 'no-store');
      if (url.pathname === '/probe' || url.pathname === '/private/account') {
        const cookies = (request.headers.cookie ?? '').split(';').map(cookie => cookie.trim());
        const hasDummySession = cookies.includes('poc_session=dummy-only');
        hits.push({ server: kind, path: url.pathname, method: request.method,
          hasDummySession, hasDummyVisibleCookie: cookies.includes('poc_visible=dummy-visible-cookie'), origin: request.headers.origin ?? '' });
        const authenticated = kind === 'app' && hasDummySession;
        response.writeHead(authenticated ? 200 : 403, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(authenticated ? { canary: 'dummy-authenticated-account' } : { error: 'No dummy session' }));
        return;
      }
      if (url.pathname === '/stats' && kind === 'app') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(hits));
        return;
      }
      if (url.pathname === '/config' && kind === 'app') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ appOrigin, executionOrigin }));
        return;
      }
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!files.has(name) || (kind === 'execution' && name === 'index.html')) {
        response.writeHead(404); response.end('Not found'); return;
      }
      try {
        const body = await readFile(path.join(root, name));
        const frame = name === 'frame.html';
        const policy = frame
          ? `default-src 'none'; script-src ${executionOrigin} https://cjrtnc.leaningtech.com/5.0/ 'wasm-unsafe-eval'${url.searchParams.get('eval') === '1' ? " 'unsafe-eval'" : ''}; worker-src blob:; connect-src https://cjrtnc.leaningtech.com/5.0/ ${executionOrigin}/generated/; img-src 'none'; style-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
          : `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ${executionOrigin}; frame-src ${executionOrigin}; object-src 'none'; base-uri 'none'; form-action 'none'`;
        response.setHeader('Content-Security-Policy', policy);
        // Only static experiment files are public to the opaque frame. Dummy private routes never get CORS headers.
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Content-Type', types[path.extname(name)] ?? 'application/octet-stream');
        if (name === 'index.html') response.setHeader('Set-Cookie', [
          'poc_session=dummy-only; HttpOnly; SameSite=Strict; Path=/',
          'poc_visible=dummy-visible-cookie; SameSite=Strict; Path=/',
        ]);
        // CheerpJ's /app filesystem uses HTTP byte ranges.
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
        if (range) {
          const start = Number(range[1]);
          const end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
          if (start > end) { response.writeHead(416); response.end(); return; }
          response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Accept-Ranges': 'bytes' });
          response.end(body.subarray(start, end + 1));
        } else {
          response.writeHead(200, { 'Accept-Ranges': 'bytes' });
          response.end(body);
        }
      } catch (error) {
        response.writeHead(500); response.end('Build the trusted bridge first. ' + error.code);
      }
    };
  }
  const app = http.createServer(handler('app'));
  const execution = http.createServer(handler('execution'));
  const listen = (server, host) => new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, host, resolve);
  });
  await listen(app, '127.0.0.1');
  await listen(execution, '127.0.0.2');
  appOrigin = 'http://127.0.0.1:' + app.address().port;
  executionOrigin = 'http://127.0.0.2:' + execution.address().port;
  return {
    appOrigin, executionOrigin, hits,
    async close() {
      await Promise.all([app, execution].map(server => new Promise(resolve => {
        server.closeAllConnections(); server.close(resolve);
      })));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const servers = await startExperiment();
  console.log('Java experiment: ' + servers.appOrigin);
  console.log('Separate execution host: ' + servers.executionOrigin);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await servers.close(); process.exit(0); });
}
