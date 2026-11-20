import { TANK_SCRIPT_LIMITS, TankScriptRunnerError } from '../shared/tankScriptRunnerProtocol.js';

// The frame owns the worker/CSP; the private data port avoids relaying every tick.
function manageJavaWorker() {
  addEventListener('message', function connect(event) {
    if (event.source !== parent || event.data !== 'connect-java' || !event.ports[0]) return;
    removeEventListener('message', connect);
    const port = event.ports[0];
    let worker;
    let workerURL;
    port.onmessage = ({ data }) => {
      if (data.type === 'terminate') {
        worker?.terminate();
        if (workerURL) URL.revokeObjectURL(workerURL);
        port.postMessage({ terminated: true });
        return;
      }
      if (data.type === 'start' && !worker && data.port) {
        workerURL = URL.createObjectURL(new Blob([data.workerSource], { type: 'text/javascript' }));
        worker = new Worker(workerURL);
        worker.onerror = event => { event.preventDefault(); port.postMessage({ workerError: true }); };
        worker.postMessage('connect-java-worker', [data.port]);
      }
    };
    port.postMessage({ bridgeReady: true });
  });
  parent.postMessage('java-frame-ready', '*');
}

export function createJavaWorkerSession(signal, { measureTimings = false } = {}) {
  if (signal?.aborted) throw new TankScriptRunnerError('DISPOSED');
  const frame = document.createElement('iframe');
  frame.sandbox = 'allow-scripts';
  frame.hidden = true;
  frame.title = 'Experimental Java execution';
  frame.setAttribute('aria-hidden', 'true');
  const nonce = crypto.randomUUID();
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><script nonce="${nonce}">(${manageJavaWorker.toString()})()</script>`;
  const channel = new MessageChannel();
  const dataChannel = new MessageChannel();
  let pending;
  let nextId = 0;
  let closed = false;
  let lastRequest;
  let readyResolve;
  let workerReadyResolve;
  let workerStarted = false;
  let finishClose;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const workerReady = new Promise(resolve => { workerReadyResolve = resolve; });
  const terminated = new Promise(resolve => { finishClose = resolve; });
  function finishRequest() {
    const request = pending; pending = undefined; clearTimeout(request?.timer); return request;
  }
  function close(code = 'DISPOSED') {
    if (closed) return terminated;
    closed = true;
    removeEventListener('message', connect);
    signal?.removeEventListener('abort', abort);
    finishRequest()?.reject(new TankScriptRunnerError(code));
    readyResolve();
    workerReadyResolve();
    channel.port1.postMessage({ type: 'terminate' });
    const fallback = setTimeout(finishClose, 250);
    terminated.then(() => {
      clearTimeout(fallback);
      channel.port1.close(); channel.port2.close();
      dataChannel.port1.close(); dataChannel.port2.close();
      frame.remove();
    });
    return terminated;
  }
  function abort() { close(); }
  function connect(event) {
    if (event.source !== frame.contentWindow || event.origin !== 'null' || event.data !== 'java-frame-ready') return;
    removeEventListener('message', connect);
    frame.contentWindow.postMessage('connect-java', '*', [channel.port2]);
  }
  addEventListener('message', connect);
  signal?.addEventListener('abort', abort, { once: true });
  channel.port1.onmessage = ({ data }) => {
    if (data?.terminated) { finishClose(); return; }
    if (closed) return;
    if (data?.bridgeReady) { readyResolve(); return; }
    if (data?.workerError) { close('WORKER_ERROR'); return; }
  };
  dataChannel.port1.onmessage = ({ data }) => {
    if (closed) return;
    if (data?.workerReady) { workerReadyResolve(); return; }
    if (!pending || data?.id !== pending.id) return;
    if (!data.result || typeof data.result !== 'object') { close('WORKER_ERROR'); return; }
    if (measureTimings) lastRequest = { ...lastRequest,
      receivedAt: performance.timeOrigin + performance.now(), worker: data.result.timing };
    finishRequest().resolve(data.result);
  };
  channel.port1.onmessageerror = () => close('WORKER_ERROR');
  dataChannel.port1.onmessageerror = () => close('WORKER_ERROR');
  document.body.append(frame);
  return {
    close,
    get lastRequest() { return lastRequest; },
    dispose: () => close(),
    request(type, fields, timeoutMs) {
      if (closed) return Promise.reject(new TankScriptRunnerError('DISPOSED'));
      if (pending) return Promise.reject(new TankScriptRunnerError('BUSY'));
      const id = ++nextId;
      const startingRuntime = !workerStarted && type === 'initializeRuntime';
      if (measureTimings) lastRequest = { type, startedAt: performance.timeOrigin + performance.now() };
      return new Promise((resolve, reject) => {
        // A new opaque frame/worker has not received any Java yet. Bound its trusted
        // startup separately; loading Wasm and every program call still get 500 ms.
        const initialTimeout = startingRuntime ? TANK_SCRIPT_LIMITS.workerStartupMs : timeoutMs;
        pending = { id, resolve, reject, timer: setTimeout(() => close('WORKER_TIMEOUT'), initialTimeout) };
        Promise.all([ready, fields]).then(([, resolved]) => {
          if (closed) return;
          const { workerSource, ...payload } = resolved;
          if (!workerStarted) {
            workerStarted = true;
            channel.port1.postMessage({ type: 'start', workerSource, port: dataChannel.port2 }, [dataChannel.port2]);
          }
          return workerReady.then(() => {
            if (closed) return;
            if (startingRuntime) {
              clearTimeout(pending.timer);
              pending.timer = setTimeout(() => close('WORKER_TIMEOUT'), timeoutMs);
            }
            if (measureTimings) lastRequest.postedAt = performance.timeOrigin + performance.now();
            dataChannel.port1.postMessage({ id, type, ...payload, measureTimings });
          });
        }).catch(() => close('WORKER_ERROR'));
      });
    },
  };
}
