// Small test-only Chrome DevTools client using Node's built-in WebSocket; no npm dependency.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function launchChrome() {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'tankscript-cheerpj-'));
  const executable = process.env.TANKSCRIPT_EXPERIMENT_CHROME
    ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const processHandle = spawn(executable, ['--headless=new', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-extensions', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!port) { processHandle.kill(); throw new Error('Chrome debugging endpoint did not start'); }
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json());
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map();
  const targets = new Map();
  const network = [];
  const errors = [];
  let nextId = 0;
  function send(method, params = {}, sessionId, timeoutMs = 180_000) {
    if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Browser closed'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  socket.onmessage = async ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    const { method, params, sessionId } = message;
    if (method === 'Target.attachedToTarget') {
      const info = { ...params.targetInfo, sessionId: params.sessionId, ready: false, alive: true };
      targets.set(info.targetId, info);
      try {
        await send('Runtime.enable', {}, info.sessionId);
        await send('Network.enable', {}, info.sessionId);
        await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, info.sessionId).catch(() => {});
      } catch (error) {
        // Cancellation can close a worker/frame while its inspector is attaching.
        if (!/No session|closed|not found/i.test(error.message)) throw error;
      } finally {
        await send('Runtime.runIfWaitingForDebugger', {}, info.sessionId).catch(() => {});
        info.ready = true;
      }
    } else if (method === 'Target.detachedFromTarget') {
      for (const target of targets.values()) if (target.sessionId === params.sessionId) target.alive = false;
    } else if (method === 'Network.responseReceived') {
      network.push({ sessionId, requestId: params.requestId, url: params.response.url,
        status: params.response.status, fromDiskCache: !!params.response.fromDiskCache,
        encodedBytes: 0, timestamp: params.timestamp });
    } else if (method === 'Network.loadingFinished') {
      const resource = network.findLast(item => item.sessionId === sessionId && item.requestId === params.requestId);
      if (resource) resource.encodedBytes = params.encodedDataLength;
    } else if (method === 'Network.loadingFailed') {
      errors.push({ method, sessionId, ...params });
    } else if (method === 'Runtime.exceptionThrown' || method === 'Log.entryAdded') {
      errors.push({ method, sessionId, ...params });
    } else if (method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(params.type)) {
      errors.push({ method, sessionId, text: params.args.map(arg => arg.value ?? arg.description ?? '').join(' ').slice(0, 3000) });
    }
  };
  await send('Target.setDiscoverTargets', { discover: true });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  async function newPage(url) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    let target;
    for (let attempt = 0; attempt < 100; attempt++) {
      target = targets.get(targetId);
      if (target?.ready) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!target?.ready) throw new Error('Could not attach to test page');
    await send('Page.enable', {}, target.sessionId);
    await send('Page.navigate', { url }, target.sessionId);
    return {
      target,
      async evaluate(expression, timeoutMs = 180_000) {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, target.sessionId, timeoutMs);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
      },
      screenshot: () => send('Page.captureScreenshot', {}, target.sessionId),
      close: () => send('Target.closeTarget', { targetId }),
    };
  }
  return {
    version, targets, network, errors, send, newPage,
    async memory() {
      const workers = [];
      for (const target of targets.values()) {
        if (!target.alive || target.type !== 'worker') continue;
        try { workers.push({ targetId: target.targetId, ...await send('Runtime.getHeapUsage', {}, target.sessionId, 3000) }); } catch {}
      }
      return workers;
    },
    async close() {
      await send('Browser.close', {}, undefined, 3000).catch(() => processHandle.kill());
      socket.close();
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Browser closed')); }
      pending.clear();
      await new Promise(resolve => setTimeout(resolve, 500));
      const resolved = path.resolve(profile);
      if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('tankscript-cheerpj-')) throw new Error('Unexpected generated profile path');
      await rm(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 500 }).catch(() => {});
    },
  };
}
