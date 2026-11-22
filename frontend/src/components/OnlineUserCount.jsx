import { useEffect, useState } from 'react';

const RETRY_DELAYS = [1000, 2000, 4000];

export function OnlineUserCount() {
  const [connection, setConnection] = useState({ status: 'connecting', count: null });

  useEffect(() => {
    const url = new URL('/ws', window.location.href);
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket;
    let retryTimer;
    let retries = 0;

    function closeSocket() {
      if (!socket) return;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }

    function reconnect() {
      closeSocket();
      setConnection({ status: 'disconnected', count: null });
      if (retries < RETRY_DELAYS.length) {
        retryTimer = window.setTimeout(connect, RETRY_DELAYS[retries]);
        retries++;
      }
    }

    function connect() {
      try {
        socket = new WebSocket(url.href);
      } catch {
        reconnect();
        return;
      }

      socket.onopen = () => {
        retries = 0;
        setConnection({ status: 'connected', count: null });
      };
      socket.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message?.type === 'online-count' && Number.isSafeInteger(message.count) && message.count >= 0) {
          setConnection({ status: 'connected', count: message.count });
        }
      };
      // Error and close can describe the same failure. Detach both before retrying.
      socket.onerror = reconnect;
      socket.onclose = reconnect;
    }

    function pauseConnection() {
      window.clearTimeout(retryTimer);
      closeSocket();
    }

    function restoreConnection(event) {
      if (!event.persisted) return;
      retries = 0;
      setConnection({ status: 'connecting', count: null });
      connect();
    }

    // Cached pages retain React state, so unmount cleanup alone is not enough.
    window.addEventListener('pagehide', pauseConnection);
    window.addEventListener('pageshow', restoreConnection);
    connect();
    return () => {
      window.removeEventListener('pagehide', pauseConnection);
      window.removeEventListener('pageshow', restoreConnection);
      pauseConnection();
    };
  }, []);

  let label = 'Connecting…';
  if (connection.status === 'connected') {
    label = connection.count === null ? 'Connected' : `${connection.count} online`;
  } else if (connection.status === 'disconnected') {
    label = 'Disconnected';
  }

  return (
    <span
      className={`online-user-count online-user-count--${connection.status}`}
      role="status"
      aria-label="Online connections"
      aria-live="polite"
      aria-atomic="true"
      title="Connected browser tabs"
    >
      <span className="online-user-count-dot" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
