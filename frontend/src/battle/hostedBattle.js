const battlePath = '/api/battles';

async function request(path, { method = 'GET', body, signal, keepalive, timeoutMs = 5_000 } = {}) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const response = await fetch(path, {
    method, signal: signal ? AbortSignal.any([signal, deadline]) : deadline, keepalive, cache: 'no-store',
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    throw Object.assign(new Error(data?.msg ?? 'The server returned an unreadable battle response.'), {
      status: response.status,
      code: data?.code,
    });
  }
  return data;
}

export async function connectHostedBattle(setup, { signal, onUpdate, onConnectionError, onFailure }) {
  const initial = await request(battlePath, { method: 'POST', body: setup, signal, timeoutMs: 32_000 });
  const path = battlePath + '/' + encodeURIComponent(initial.id);
  let latest = initial;
  let timer;
  let stopped = false;
  let retryDelay = 250;
  let controls = Promise.resolve();
  let cleanup;

  function terminal() {
    return latest.phase === 'complete' || latest.phase === 'stopped';
  }

  function dispose() {
    if (cleanup) return cleanup;
    stopped = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', dispose);
    cleanup = terminal()
      ? Promise.resolve()
      : request(path, { method: 'DELETE', keepalive: true, timeoutMs: 15_000 }).catch(() => {
        // The server's idle deadline also covers a page that loses its connection.
      });
    return cleanup;
  }

  function apply(battle, effects = [], resync = false) {
    if (battle.id !== initial.id || battle.sequence <= latest.sequence) return;
    latest = battle;
    onUpdate(battle, effects, resync);
  }

  async function poll() {
    if (stopped || terminal()) return;
    let delay = latest.phase === 'paused' ? 1_000 : 125;
    try {
      const response = await request(path + '/updates?since=' + latest.sequence, { signal });
      if (stopped) return;
      if (response.resync) {
        apply(response.resync, [], true);
      } else {
        for (const { battle, effects } of response.updates) {
          if (battle.sequence > latest.sequence + 1) {
            const snapshot = await request(path, { signal });
            if (!stopped) apply(snapshot, [], true);
            break;
          }
          apply(battle, effects);
        }
      }
      if (stopped) return;
      retryDelay = 250;
      onConnectionError('');
      delay = latest.phase === 'paused' ? 1_000 : Math.min(500, latest.speed * 1000);
    } catch (error) {
      if (stopped) return;
      if (error.code === 'BATTLES_DISABLED' || (error.status >= 400 && error.status < 500 && error.status !== 429)) {
        onFailure(error);
        return;
      }
      onConnectionError('Connection interrupted. Reconnecting to the battle…');
      delay = error.status === 429 ? 10_000 : retryDelay;
      retryDelay = Math.min(retryDelay * 2, 2_000);
    }
    if (!stopped && !terminal()) timer = setTimeout(poll, delay);
  }

  function control(suffix, method, body) {
    const operation = controls.then(() => {
      if (!stopped && !terminal()) return request(path + suffix, { method, body, signal });
    });
    controls = operation.catch(() => {});
    return operation;
  }

  if (signal.aborted) {
    void dispose();
    signal.throwIfAborted();
  }
  signal.addEventListener('abort', dispose, { once: true });
  onUpdate(initial, [], true);
  if (!terminal()) timer = setTimeout(poll, 125);
  return {
    pause: () => control('/pause', 'POST'),
    resume: () => control('/resume', 'POST'),
    setSpeed: speed => control('', 'PATCH', { speed }),
    dispose,
  };
}
