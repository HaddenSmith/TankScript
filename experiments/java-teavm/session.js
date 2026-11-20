const actions = ['moveUp', 'moveDown', 'moveLeft', 'moveRight', 'rotateLeft', 'rotateRight', 'shoot'];
let assetsPromise;

export function loadAssets() {
  if (!assetsPromise) assetsPromise = (async () => {
    const startedAt = performance.now();
    const reference = await fetch('/asset-lock.json').then(response => response.json());
    const lock = await fetch('/generated/asset-manifest.json').then(response => response.json());
    for (const key of Object.keys(reference)) {
      if (key !== 'files' && lock[key] !== reference[key]) throw new Error('Toolchain version mismatch: ' + key);
    }
    const cspLock = await fetch('/generated/csp-runtime-manifest.json').then(response => response.json());
    if (cspLock.stockHash !== lock.files['compiler.wasm-runtime.js']) throw new Error('CSP runtime base version mismatch');
    const assets = {};
    const files = { ...lock.files, 'compiler.csp-runtime.js': cspLock.patchedHash };
    for (const [name, hash] of Object.entries(files)) {
      const response = await fetch('/generated/assets/' + name + '?sha256=' + hash);
      if (!response.ok) throw new Error('Missing toolchain file: ' + name);
      const bytes = await response.arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
      if (digest !== hash) throw new Error('Toolchain checksum mismatch: ' + name);
      assets[name] = bytes;
    }
    return { assets, elapsedMs: performance.now() - startedAt };
  })();
  return assetsPromise;
}

export async function createSession({ role = 'compiler', loader = 'csp', allowWasm = true } = {}) {
  if (!['csp','stock'].includes(loader)) throw new Error('Unknown TeaVM loader');
  const { assets } = await loadAssets();
  const config = await fetch('/config').then(response => response.json());
  const workerSource = await fetch('/worker.js').then(response => response.text());
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.title = 'Isolated TeaVM ' + role;
  frame.sandbox = 'allow-scripts';
  const frameURL = new URL('/frame.html', config.executionOrigin);
  frameURL.searchParams.set('parent', location.origin);
  frameURL.searchParams.set('wasm', allowWasm ? '1' : '0');
  frame.src = frameURL.href;
  const channel = new MessageChannel();
  let pending;
  let nextId = 0;
  let closed = false;
  let readyResolve;
  let readyReject;
  let isolation;
  let terminatedResolve;
  const terminated = new Promise(resolve => { terminatedResolve = resolve; });
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  ready.catch(() => {});
  const createdAt = performance.now();
  function finishPending(error, data) {
    const request = pending; pending = undefined; clearTimeout(request?.timer);
    if (error) request?.reject(error); else request?.resolve(data);
  }
  function dispose(reason = 'Disposed') {
    if (closed) return terminated;
    closed = true; clearTimeout(initializationTimer); window.removeEventListener('message', connect);
    readyReject(new Error(reason)); finishPending(new Error(reason));
    channel.port1.postMessage({ type: 'terminate' });
    const finish = () => { frame.remove(); channel.port1.close(); terminatedResolve(); };
    const fallback = setTimeout(finish, 250);
    terminated.then(() => { clearTimeout(fallback); finish(); });
    return terminated;
  }
  function connect(event) {
    if (event.source !== frame.contentWindow || event.origin !== 'null' || event.data !== 'teavm-frame-ready') return;
    window.removeEventListener('message', connect);
    frame.contentWindow.postMessage('connect-teavm', '*', [channel.port2]);
  }
  channel.port1.onmessage = ({ data }) => {
    if (data.terminated) { terminatedResolve(); return; }
    if (closed) return;
    if (data.frameReady) {
      isolation = data.isolation;
      const runtimeName = loader === 'stock' ? 'compiler.wasm-runtime.js' : 'compiler.csp-runtime.js';
      const workerAssets = role === 'compiler' ? assets : { [runtimeName]: assets[runtimeName] };
      channel.port1.postMessage({ type: 'start', role, loader, workerSource, assets: workerAssets });
    }
    else if (data.fatal) dispose(data.fatal);
    else if (data.ready) { clearTimeout(initializationTimer); readyResolve({ ...data, isolation, wallMs: performance.now() - createdAt }); }
    else if (pending && pending.id === data.id) finishPending(null, data);
  };
  channel.port1.onmessageerror = () => dispose('Unreadable worker message');
  window.addEventListener('message', connect);
  document.body.append(frame);
  const initializationTimer = setTimeout(() => dispose('Initialization timed out'), 120_000);
  async function request(type, fields = {}, timeoutMs = 60_000) {
    await ready;
    if (closed) throw new Error('Disposed');
    if (pending) throw new Error('BUSY');
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending = { id, resolve, reject, timer: setTimeout(() => dispose(type + ' timed out; worker terminated'), timeoutMs) };
      channel.port1.postMessage({ id, type, ...fields });
    });
  }
  return { ready, request, dispose,
    compile(source) {
      if (typeof source !== 'string' || source.length > 100_000) throw new Error('Invalid source length');
      return request('compile', { source }, 120_000);
    },
    load(wasm) { return request('load', { wasm }); },
    construct(timeoutMs = 500) { return request('construct', {}, timeoutMs); },
    async runTick(snapshot, timeoutMs = 500) {
      const reply = await request('tick', { snapshot }, timeoutMs);
      if (reply.ok && reply.result !== null && !actions.includes(reply.result)) throw new Error('Unsupported action from Java');
      return reply;
    },
  };
}
