import { TankScriptRunnerError } from '../shared/tankScriptRunnerProtocol.js';

// As in the Python runner, the opaque frame owns the worker and its inherited CSP.
function relayJavaWorker() {
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
      if (!worker) {
        workerURL = URL.createObjectURL(new Blob([data.workerSource], { type: 'text/javascript' }));
        worker = new Worker(workerURL);
        worker.onmessage = ({ data }) => port.postMessage(data);
        worker.onerror = event => { event.preventDefault(); port.postMessage({ workerError: true }); };
      }
      worker.postMessage(data);
    };
    port.postMessage({ bridgeReady: true });
  });
  parent.postMessage('java-frame-ready', '*');
}

export function createJavaWorkerSession(signal) {
  if (signal?.aborted) throw new TankScriptRunnerError('DISPOSED');
  const frame = document.createElement('iframe');
  frame.sandbox = 'allow-scripts';
  frame.hidden = true;
  frame.title = 'Experimental Java execution';
  frame.setAttribute('aria-hidden', 'true');
  const nonce = crypto.randomUUID();
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><script nonce="${nonce}">(${relayJavaWorker.toString()})()</script>`;
  const channel = new MessageChannel();
  let pending;
  let nextId = 0;
  let closed = false;
  let readyResolve;
  let finishClose;
  const ready = new Promise(resolve => { readyResolve = resolve; });
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
    channel.port1.postMessage({ type: 'terminate' });
    const fallback = setTimeout(finishClose, 250);
    terminated.then(() => { clearTimeout(fallback); channel.port1.close(); frame.remove(); });
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
    if (!pending || data?.id !== pending.id) return;
    if (!data.result || typeof data.result !== 'object') { close('WORKER_ERROR'); return; }
    finishRequest().resolve(data.result);
  };
  channel.port1.onmessageerror = () => close('WORKER_ERROR');
  document.body.append(frame);
  return {
    close,
    dispose: () => close(),
    request(type, fields, timeoutMs) {
      if (closed) return Promise.reject(new TankScriptRunnerError('DISPOSED'));
      if (pending) return Promise.reject(new TankScriptRunnerError('BUSY'));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending = { id, resolve, reject, timer: setTimeout(() => close('WORKER_TIMEOUT'), timeoutMs) };
        Promise.all([ready, fields]).then(([, resolved]) => {
          if (!closed) channel.port1.postMessage({ id, type, ...resolved });
        }).catch(() => close('WORKER_ERROR'));
      });
    },
  };
}
