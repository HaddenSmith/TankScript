import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { createAccountDetails, getAuthCookie } from '../helpers/apiFixtures.cjs';
import { startLiveService, stopLiveService } from '../helpers/liveService.cjs';

describe('tank API', () => {
  let baseUrl;
  let cookie;

  beforeAll(async () => {
    baseUrl = await startLiveService();
    const registration = await request(baseUrl).post('/api/auth/create').send(createAccountDetails());
    cookie = getAuthCookie(registration);
  });

  afterAll(async () => {
    await stopLiveService();
  });

  test('creates, retrieves, updates, and deletes an owned tank', async () => {
    const created = await request(baseUrl).post('/api/tanks')
      .set('Cookie', cookie)
      .send({ tank: { name: '  Ember  ', code: 'shoot();', color: '#AABBCC' } });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Ember',
      code: 'shoot();',
      color: '#AABBCC',
    });
    expect(created.body._id).toBeUndefined();

    const owned = await request(baseUrl).get('/api/tanks').set('Cookie', cookie);
    const community = await request(baseUrl).get('/api/tanks/all').set('Cookie', cookie);
    expect(owned.status).toBe(200);
    expect(owned.body).toHaveLength(1);
    const communityTank = community.body.find((tank) => tank.id === created.body.id);
    expect(communityTank).toBeDefined();
    expect(communityTank._id).toBeUndefined();

    const updated = await request(baseUrl).put(`/api/tanks/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ tank: { name: 'Updated', code: 'moveUp();', color: 'blue' } });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Updated');

    const deleted = await request(baseUrl).delete(`/api/tanks/${created.body.id}`).set('Cookie', cookie);
    expect(deleted.status).toBe(204);
    expect((await request(baseUrl).get('/api/tanks').set('Cookie', cookie)).body).toEqual([]);
    expect((await request(baseUrl).delete(`/api/tanks/${created.body.id}`).set('Cookie', cookie)).status).toBe(404);
  });

  test.each([
    [{ name: '', code: 'shoot();', color: 'teal' }],
    [{ name: 'Tank', code: '', color: 'teal' }],
    [{ name: 'Tank', code: 'shoot();', color: '#abc' }],
    [{ name: 'Tank', code: 'shoot();', color: 'not-a-color' }],
  ])('rejects invalid tank fields %#', async (tank) => {
    const response = await request(baseUrl).post('/api/tanks').set('Cookie', cookie).send({ tank });
    expect(response.status).toBe(400);
    expect(response.body.msg).toBeTruthy();
  });

  test('rejects malformed JSON and returns 404 for an unknown tank', async () => {
    const malformed = await request(baseUrl).post('/api/tanks')
      .set('Cookie', cookie)
      .set('Content-Type', 'application/json')
      .send('{"tank":');
    const missing = await request(baseUrl).delete('/api/tanks/missing-id').set('Cookie', cookie);

    expect(malformed.status).toBe(400);
    expect(missing.status).toBe(404);
  });
});
