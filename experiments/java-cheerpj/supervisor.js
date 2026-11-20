const actions = ['moveUp', 'moveDown', 'moveLeft', 'moveRight', 'rotateLeft', 'rotateRight', 'shoot'];

export async function createJavaSession({ mode = 'opaque', allowEval = false, onStatus = () => {} } = {}) {
  const config = await fetch('/config').then(response => response.json());
  config.bridgeBytes = Array.from(new Uint8Array(await fetch('/generated/bridge.jar').then(response => response.arrayBuffer())));
  const workerSource = await fetch('/worker.js').then(response => response.text());
  const frame = document.createElement('iframe');
  frame.title = 'Isolated CheerpJ experiment';
  frame.hidden = true;
  frame.sandbox = mode === 'opaque' ? 'allow-scripts' : 'allow-scripts allow-same-origin';
  const url = new URL('/frame.html', config.executionOrigin);
  url.searchParams.set('parent', location.origin);
  url.searchParams.set('eval', allowEval ? '1' : '0');
  frame.src = url.href;
  const channel = new MessageChannel();
  let pending;
  let nextId = 0;
  let closed = false;
  let initializationTimer;
  let readyResolve;
  let readyReject;
  let isolation;
  let terminatedResolve;
  const terminated = new Promise(resolve => { terminatedResolve = resolve; });
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Cancellation can precede the caller awaiting ready.
  ready.catch(() => {});
  const createdAt = performance.now();

  function settlePending(error, response) {
    const request = pending;
    pending = null;
    clearTimeout(request?.timer);
    if (error) request?.reject(error);
    else request?.resolve(response);
  }
  function dispose(reason = 'Disposed') {
    if (closed) return terminated;
    closed = true;
    clearTimeout(initializationTimer);
    window.removeEventListener('message', connect);
    channel.port1.postMessage({ type: 'terminate' });
    readyReject(new Error(reason));
    settlePending(new Error(reason));
    // The relay stays responsive even while Java loops inside its worker.
    const finish = () => { frame.remove(); channel.port1.close(); terminatedResolve(); };
    const fallback = setTimeout(finish, 250);
    terminated.then(() => { clearTimeout(fallback); frame.remove(); channel.port1.close(); });
    return terminated;
  }
  function connect(event) {
    const expectedOrigin = mode === 'opaque' ? 'null' : config.executionOrigin;
    if (event.source !== frame.contentWindow || event.origin !== expectedOrigin || event.data !== 'java-experiment-frame-ready') return;
    window.removeEventListener('message', connect);
    frame.contentWindow.postMessage('java-experiment-connect', expectedOrigin === 'null' ? '*' : expectedOrigin, [channel.port2]);
  }
  channel.port1.onmessage = ({ data }) => {
    if (data.terminated) { terminatedResolve(); return; }
    if (closed) return;
    if (data.frameReady) {
      isolation = data.isolation;
      channel.port1.postMessage({ type: 'start', config, workerSource });
    } else if (data.status) {
      onStatus(data);
    } else if (data.ready) {
      clearTimeout(initializationTimer);
      readyResolve({ ...data, frameIsolation: isolation, wallMs: performance.now() - createdAt });
    } else if (data.fatal) {
      onStatus(data);
      dispose(data.message);
    } else if (pending && pending.id === data.id) {
      settlePending(null, data);
    }
  };
  channel.port1.onmessageerror = () => dispose('Unreadable worker reply');
  window.addEventListener('message', connect);
  document.body.append(frame);
  initializationTimer = setTimeout(() => dispose('Runtime initialization deadline exceeded (120 seconds)'), 120_000);

  async function request(type, fields = {}, timeoutMs = 30_000) {
    await ready;
    if (closed) throw new Error('Disposed');
    if (pending) throw new Error('BUSY');
    if (type === 'compile' && (typeof fields.source !== 'string' || fields.source.length > 100_000)) throw new Error('Invalid source length');
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending = { id, resolve, reject, timer: setTimeout(() => {
        dispose(type + ' deadline exceeded; worker terminated');
      }, timeoutMs) };
      channel.port1.postMessage({ id, type, ...fields });
    });
  }
  return {
    ready, request, dispose,
    async compile(source, timeoutMs = 60_000) { return request('compile', { source }, timeoutMs); },
    async construct(timeoutMs = 500) { return request('construct', {}, timeoutMs); },
    async runTick(snapshot, timeoutMs = 500) {
      const reply = await request('tick', { snapshot }, timeoutMs);
      if (reply.ok && reply.result !== null && !actions.includes(reply.result)) throw new Error('Unsupported action from Java');
      return reply;
    },
  };
}
