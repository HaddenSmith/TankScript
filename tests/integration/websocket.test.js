import { afterAll, afterEach, beforeAll, expect, test } from '@jest/globals';
import { WebSocket } from 'ws';
import { startLiveService, stopLiveService } from '../helpers/liveService.cjs';

let baseUrl;
const sockets = new Set();
beforeAll(async () => { baseUrl = await startLiveService(); });
afterEach(() => { for (const socket of sockets) socket.terminate(); sockets.clear(); });
afterAll(async () => { await stopLiveService(); });

async function waitFor(check, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= deadline) throw Error('Timed out waiting for the WebSocket lifecycle.');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function connect(options) {
  const socket = new WebSocket(baseUrl.replace('http:', 'ws:') + '/ws', options);
  sockets.add(socket);
  const counts = [];
  socket.on('message', data => { const message = JSON.parse(data.toString()); if (message.type === 'online-count') counts.push(message.count); });
  await waitFor(() => socket.readyState === WebSocket.OPEN);
  return { socket, counts };
}

test('broadcasts connection counts and contains oversized messages without losing healthy clients', async () => {
  const healthy = await connect();
  await waitFor(() => healthy.counts.at(-1) === 1);
  const oversized = await connect();
  await waitFor(() => healthy.counts.at(-1) === 2 && oversized.counts.at(-1) === 2);
  const closed = new Promise(resolve => oversized.socket.once('close', code => resolve(code)));
  oversized.socket.send('x'.repeat(2048));
  expect(await closed).toBe(1009);
  await waitFor(() => healthy.counts.at(-1) === 1);
  expect(healthy.socket.readyState).toBe(WebSocket.OPEN);
  expect((await fetch(baseUrl + '/api/health')).status).toBe(200);
});

test('heartbeat removes a client that stops answering pings while preserving healthy connections', async () => {
  const healthy = await connect();
  const silent = await connect({ autoPong: false });
  await waitFor(() => healthy.counts.at(-1) === 2);
  await waitFor(() => silent.socket.readyState === WebSocket.CLOSED, 23_000);
  await waitFor(() => healthy.counts.at(-1) === 1);
  expect(healthy.socket.readyState).toBe(WebSocket.OPEN);
}, 25_000);
