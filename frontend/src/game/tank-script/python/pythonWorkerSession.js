import { TankScriptRunnerError } from '../shared/tankScriptRunnerProtocol.js';

// The frame's opaque origin keeps Python away from app storage and credentials.
// Its inherited CSP also blocks network access, including through Python's JS bridge.
function relayPythonWorker() {
  function connect(event) {
    if (event.source !== parent || event.data !== 'connect-python' || !event.ports[0]) return;
    removeEventListener('message', connect);
    const port = event.ports[0];
    let worker;
    port.onmessage = ({ data }) => {
      if (!worker) {
        const workerURL = URL.createObjectURL(new Blob([data.workerSource], { type: 'text/javascript' }));
        worker = new Worker(workerURL);
        worker.onmessage = ({ data }) => port.postMessage(data);
        worker.onerror = (event) => {
          event.preventDefault();
          port.postMessage({ workerError: true });
        };
      }
      worker.postMessage(data, data.assets ? [data.assets.wasm] : []);
    };
    port.postMessage({ bridgeReady: true });
  }
  addEventListener('message', connect);
  parent.postMessage('python-frame-ready', '*');
}

export function createPythonWorkerSession(signal) {
  if (signal?.aborted) throw new TankScriptRunnerError('DISPOSED');
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.title = 'Python execution';
  frame.hidden = true;
  const nonce = crypto.randomUUID();
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src blob: data:"><script nonce="${nonce}">(${relayPythonWorker.toString()})()</script>`;
  const channel = new MessageChannel();
  let pending;
  let nextId = 0;
  let closed = false;
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });

  function finishRequest() {
    const request = pending;
    pending = undefined;
    clearTimeout(request?.timer);
    return request;
  }
  function close(code = 'DISPOSED') {
    if (closed) return;
    closed = true;
    window.removeEventListener('message', connect);
    signal?.removeEventListener('abort', abort);
    channel.port1.onmessage = null;
    channel.port1.onmessageerror = null;
    channel.port1.close();
    frame.remove();
    finishRequest()?.reject(new TankScriptRunnerError(code));
    readyResolve();
  }
  function abort() { close(); }
  function connect(event) {
    if (event.source !== frame.contentWindow || event.origin !== 'null' || event.data !== 'python-frame-ready') return;
    window.removeEventListener('message', connect);
    frame.contentWindow.postMessage('connect-python', '*', [channel.port2]);
  }
  window.addEventListener('message', connect);
  signal?.addEventListener('abort', abort, { once: true });
  channel.port1.onmessage = ({ data }) => {
    if (data?.bridgeReady) return readyResolve();
    if (data?.workerError) return close('WORKER_ERROR');
    if (!pending || data?.id !== pending.id) return;
    if (!data.result || typeof data.result !== 'object') return close('WORKER_ERROR');
    finishRequest().resolve(data.result);
  };
  channel.port1.onmessageerror = () => close('WORKER_ERROR');
  document.body.append(frame);

  return {
    close,
    async request(type, fields, timeoutMs) {
      if (closed) throw new TankScriptRunnerError('DISPOSED');
      if (pending) throw new TankScriptRunnerError('BUSY');
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending = { id, resolve, reject, timer: setTimeout(() => close('WORKER_TIMEOUT'), timeoutMs) };
        Promise.all([ready, fields]).then(([, fields]) => {
          if (closed) return;
          try {
            channel.port1.postMessage({ id, type, ...fields }, fields?.assets ? [fields.assets.wasm] : []);
          } catch {
            close('WORKER_ERROR');
          }
        }).catch(() => close('WORKER_ERROR'));
      });
    },
    async dispose() {
      if (closed) return;
      try {
        if (!pending) await this.request('dispose', {}, 500);
      } finally {
        close();
      }
    },
  };
}
