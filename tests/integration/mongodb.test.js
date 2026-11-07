import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { startLiveService, stopLiveService } from '../helpers/liveService.cjs';

const execFileAsync = promisify(execFile);

describe('MongoDB persistence', () => {
  let baseUrl;
  let cookie;
  let owner;
  let tank;

  beforeAll(async () => {
    baseUrl = await startLiveService();
    const id = randomUUID().replace(/-/g, '').slice(0, 12);
    owner = {
      email: `restart-${id}@example.test`,
      username: `Restart_${id}`,
      password: 'securepass123',
    };
    const registration = await request(baseUrl).post('/api/auth/create').send(owner);
    expect(registration.status).toBe(201);
    cookie = registration.headers['set-cookie'][0].split(';', 1)[0];

    const createdTank = await request(baseUrl).post('/api/tanks')
      .set('Cookie', cookie)
      .send({ tank: { name: 'Persistent tank', code: 'shoot();', color: '#317d84' } });
    expect(createdTank.status).toBe(201);
    tank = createdTank.body;
  });

  afterAll(async () => {
    await stopLiveService();
  });

  test('keeps accounts, authentication tokens, and tanks after a backend restart', async () => {
    await stopLiveService();
    baseUrl = await startLiveService();

    const session = await request(baseUrl).get('/api/auth/me').set('Cookie', cookie);
    const tanks = await request(baseUrl).get('/api/tanks').set('Cookie', cookie);

    expect(session.status).toBe(200);
    expect(session.body).toEqual({ email: owner.email, username: owner.username });
    expect(tanks.status).toBe(200);
    expect(tanks.body).toHaveLength(1);
    expect(tanks.body[0]).toMatchObject({
      id: tank.id,
      name: tank.name,
      ownerUsername: owner.username,
    });
    expect(tanks.body[0]._id).toBeUndefined();
  });

  test('fails startup if the configured service port is already in use', async () => {
    const port = new URL(baseUrl).port;
    await expect(execFileAsync(process.execPath, ['index.js', port], {
      cwd: 'service',
      timeout: 15000,
    })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('EADDRINUSE'),
      stdout: expect.not.stringContaining('Listening on port'),
    });
  });
});
