import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { createBattleManager } from '../../backend/battles/manager.js';
import { createBattleRouter } from '../../backend/battles/router.js';

const express = createRequire(resolve('backend/package.json'))('express');

const setup = {
  participants: [{ type: 'official', id: 'easy' }, { type: 'official', id: 'medium' }],
  arenaSize: 8, startingHealth: 3, speed: 1,
};
let manager;
let api;
let dispose;

function verifyFixtureOwner(req, res, next) {
  const username = req.get('X-Fixture-Owner');
  if (!username) return res.sendStatus(401);
  req.user = { username };
  next();
}

function mount(battles) {
  const app = express();
  app.use('/api/battles', createBattleRouter(battles, verifyFixtureOwner));
  return request(app);
}

beforeEach(() => {
  dispose = jest.fn(async () => {});
  manager = createBattleManager({
    startRunner: async () => ({
      runTick: async states => ({ results: states.map(({ tankId }) => ({ tankId })) }),
      dispose,
    }),
  });
  api = mount(manager);
});

afterEach(() => manager.shutdown());

test('reports unconfirmed container removal and keeps new starts blocked', async () => {
  dispose.mockRejectedValue(Object.assign(new Error('Private Docker output'), {
    code: 'CLEANUP_FAILED', containerName: 'fixture-container',
  }));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const initial = await api.post('/api/battles').set('X-Fixture-Owner', 'pilot').send(setup).expect(201);
    const path = '/api/battles/' + initial.body.id;
    const stopped = await api.delete(path).set('X-Fixture-Owner', 'pilot').expect(503);
    expect(stopped.body).toEqual({
      code: 'CLEANUP_FAILED', msg: 'The server could not confirm battle container cleanup.',
    });
    await api.delete(path).set('X-Fixture-Owner', 'pilot').expect(503);
    await api.post('/api/battles').set('X-Fixture-Owner', 'pilot').send(setup).expect(503);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
  } finally {
    log.mockRestore();
  }
});

test('serves the initial state and ordered updates, and enforces ownership on every route', async () => {
  await api.post('/api/battles').send(setup).expect(401);
  const initial = await api.post('/api/battles').set('X-Fixture-Owner', 'pilot').send(setup).expect(201);
  const path = '/api/battles/' + initial.body.id;
  expect(initial.body).toMatchObject({ phase: 'running', state: { tickCount: 0 } });
  expect(initial.headers['cache-control']).toBe('no-store');
  for (const [method, suffix] of [
    ['get', ''], ['get', '/updates?since=0'], ['post', '/pause'], ['post', '/resume'], ['patch', ''], ['delete', ''],
  ]) {
    const response = api[method](path + suffix).set('X-Fixture-Owner', 'other');
    if (method === 'patch') response.send({ speed: 0.125 });
    await response.expect(404);
  }
  await api.get(path).set('X-Fixture-Owner', 'pilot').expect(200);
  const paused = await api.post(path + '/pause').set('X-Fixture-Owner', 'pilot').expect(200);
  expect(paused.body.phase).toBe('paused');
  const changed = await api.patch(path).set('X-Fixture-Owner', 'pilot').send({ speed: 0.5 }).expect(200);
  expect(changed.body.speed).toBe(0.5);
  await api.post(path + '/resume').set('X-Fixture-Owner', 'pilot').expect(200);
  const updates = await api.get(path + '/updates?since=' + initial.body.sequence).set('X-Fixture-Owner', 'pilot').expect(200);
  expect(updates.body.updates.map(entry => entry.battle.sequence)).toEqual([2, 3, 4]);
  await api.delete(path).set('X-Fixture-Owner', 'pilot').expect(204);
  const stopped = await api.get(path).set('X-Fixture-Owner', 'pilot').expect(200);
  expect(stopped.body.phase).toBe('stopped');
});

test('rejects a disabled feature, cross-origin mutations, oversized bodies and excess starts', async () => {
  await mount(null).post('/api/battles').send(setup).expect(503);
  await api.post('/api/battles').set('X-Fixture-Owner', 'pilot')
    .set('Origin', 'https://example.test').send(setup).expect(403);
  await api.post('/api/battles').set('X-Fixture-Owner', 'pilot')
    .send({ setup, padding: 'x'.repeat(4_096) }).expect(413);
  await api.get('/api/battles/not-an-id').set('X-Fixture-Owner', 'pilot').expect(400);
  await api.post('/api/battles').set('X-Fixture-Owner', 'pilot').send(setup).expect(201);
  for (let count = 0; count < 2; count++) {
    await api.post('/api/battles').set('X-Fixture-Owner', 'pilot').send(setup).expect(409);
  }
  await api.post('/api/battles').set('X-Fixture-Owner', 'pilot').send(setup).expect(429);
});
