const expectedParent = new URL(location.href).searchParams.get('parent');
addEventListener('message', function connect(event) {
  if (event.source !== parent || event.origin !== expectedParent || event.data !== 'connect-teavm' || !event.ports[0]) return;
  removeEventListener('message', connect);
  const port = event.ports[0];
  const isolation = { origin: self.origin };
  for (const [key, read] of Object.entries({ parentDocument: () => parent.document.title,
    parentLocalStorage: () => parent.localStorage.getItem('teavm_account'), ownCookie: () => document.cookie,
    ownLocalStorage: () => localStorage.getItem('teavm_account') })) {
    try { isolation[key] = { value: read() }; } catch (error) { isolation[key] = { error: error.name }; }
  }
  let worker;
  let workerURL;
  port.onmessage = ({ data }) => {
    if (data.type === 'start') {
      workerURL = URL.createObjectURL(new Blob([data.workerSource], { type: 'text/javascript' }));
      worker = new Worker(workerURL);
      worker.onmessage = ({ data }) => port.postMessage(data);
      worker.onerror = event => { event.preventDefault(); port.postMessage({ fatal: event.message || 'Worker failed' }); };
      worker.postMessage(data);
    } else if (data.type === 'terminate') {
      worker?.terminate();
      if (workerURL) URL.revokeObjectURL(workerURL);
      port.postMessage({ terminated: true });
    } else worker?.postMessage(data);
  };
  port.postMessage({ frameReady: true, isolation });
});
parent.postMessage('teavm-frame-ready', expectedParent);
