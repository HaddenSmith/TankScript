// This frame has a different host from the dummy app, or an opaque origin.
const expectedParent = new URL(location.href).searchParams.get('parent');
let worker;
let workerURL;
addEventListener('message', function connect(event) {
  if (event.source !== parent || event.origin !== expectedParent || event.data !== 'java-experiment-connect' || !event.ports[0]) return;
  removeEventListener('message', connect);
  const port = event.ports[0];
  const isolation = { origin: self.origin };
  for (const [key, read] of Object.entries({
    parentDocument: () => parent.document.title,
    parentLocalStorage: () => parent.localStorage.getItem('poc_account'),
    ownCookie: () => document.cookie,
    ownLocalStorage: () => localStorage.getItem('poc_account'),
  })) {
    try { isolation[key] = { value: read() }; }
    catch (error) { isolation[key] = { error: error.name }; }
  }
  port.onmessage = ({ data }) => {
    if (data.type === 'start') {
      workerURL = URL.createObjectURL(new Blob([
        'self.EXPERIMENT_CONFIG = ' + JSON.stringify(data.config) + ';\n', data.workerSource,
      ], { type: 'text/javascript' }));
      worker = new Worker(workerURL);
      worker.onmessage = ({ data }) => port.postMessage(data);
      worker.onerror = event => {
        event.preventDefault(); port.postMessage({ fatal: true, message: event.message });
      };
    } else if (data.type === 'terminate') {
      worker?.terminate();
      if (workerURL) URL.revokeObjectURL(workerURL);
      port.postMessage({ terminated: true });
    } else {
      worker?.postMessage(data);
    }
  };
  port.postMessage({ frameReady: true, isolation });
});
parent.postMessage('java-experiment-frame-ready', expectedParent);
