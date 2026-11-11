import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { connectHostedBattle } from '../../../frontend/src/battle/hostedBattle.js';

const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const state = (sequence, phase = 'running') => ({ id: 'battle-id', phase, sequence, speed: 0.125, state: { tickCount: sequence - 1 } });
const originalFetch = global.fetch;
let controller;
let options;

beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = jest.fn().mockResolvedValueOnce(response(state(1), 201));
  controller = new AbortController();
  options = {
    signal: controller.signal, onUpdate: jest.fn(), onConnectionError: jest.fn(), onFailure: jest.fn(),
  };
});

afterEach(() => {
  controller.abort();
  global.fetch = originalFetch;
  jest.useRealTimers();
});

test('keeps one poll pending, ignores duplicate updates, and preserves effect order', async () => {
  let respond;
  fetch.mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }));
  await connectHostedBattle({}, options);
  await jest.advanceTimersByTimeAsync(1_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  respond(response({ resync: null, updates: [
    { battle: state(1), effects: [{ id: 0 }] },
    { battle: state(2), effects: [{ id: 1 }] },
    { battle: state(3, 'complete'), effects: [{ id: 2 }] },
  ] }));
  await jest.advanceTimersByTimeAsync(1_000);
  expect(options.onUpdate.mock.calls).toEqual([
    [state(1), [], true], [state(2), [{ id: 1 }], false], [state(3, 'complete'), [{ id: 2 }], false],
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('retries a temporary failure and replaces state on a server resynchronization', async () => {
  fetch.mockRejectedValueOnce(new Error('network interrupted'))
    .mockResolvedValueOnce(response({ updates: [], resync: state(6) }))
    .mockResolvedValue(response(null, 204));
  await connectHostedBattle({}, options);
  await jest.advanceTimersByTimeAsync(125);
  expect(options.onConnectionError).toHaveBeenLastCalledWith(expect.stringContaining('Reconnecting'));
  await jest.advanceTimersByTimeAsync(250);
  expect(options.onUpdate).toHaveBeenLastCalledWith(state(6), [], true);
  expect(options.onConnectionError).toHaveBeenLastCalledWith('');
  controller.abort();
  expect(fetch).toHaveBeenLastCalledWith('/api/battles/battle-id', expect.objectContaining({ method: 'DELETE', keepalive: true }));
});

test('aborts the pending poll and ignores responses after reset', async () => {
  let respond;
  fetch.mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }))
    .mockResolvedValue(response(null, 204));
  const hosted = await connectHostedBattle({}, options);
  await jest.advanceTimersByTimeAsync(125);
  const pollingSignal = fetch.mock.calls[1][1].signal;
  controller.abort();
  respond(response({ resync: state(8), updates: [] }));
  await hosted.dispose();
  await jest.advanceTimersByTimeAsync(1_000);
  expect(pollingSignal.aborted).toBe(true);
  expect(options.onUpdate).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('recovers an unexpected cursor gap and serializes pause, speed and resume', async () => {
  fetch.mockResolvedValueOnce(response({ updates: [{ battle: state(4), effects: [] }], resync: null }))
    .mockResolvedValueOnce(response(state(4, 'paused')))
    .mockResolvedValue(response(null, 204));
  const hosted = await connectHostedBattle({}, options);
  await jest.advanceTimersByTimeAsync(125);
  expect(fetch.mock.calls[2][0]).toBe('/api/battles/battle-id');
  expect(options.onUpdate).toHaveBeenLastCalledWith(state(4, 'paused'), [], true);
  await Promise.all([hosted.pause(), hosted.setSpeed(0.5), hosted.resume()]);
  expect(fetch.mock.calls.slice(3).map(([url, request]) => [url, request.method])).toEqual([
    ['/api/battles/battle-id/pause', 'POST'],
    ['/api/battles/battle-id', 'PATCH'],
    ['/api/battles/battle-id/resume', 'POST'],
  ]);
});
