import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { createAccountDetails, getAuthCookie } from '../helpers/apiFixtures.cjs';
import { startLiveService, stopLiveService } from '../helpers/liveService.cjs';

describe('API authorization', () => {
  let baseUrl;

  beforeAll(async () => {
    baseUrl = await startLiveService();
  });

  afterAll(async () => {
    await stopLiveService();
  });

  test('rejects protected reads and writes without a valid token', async () => {
    const tankUpdate = await request(baseUrl).put('/api/tanks/unknown')
      .send({ tank: { name: 'Tank', code: 'shoot();', color: 'teal' } });
    const tankDelete = await request(baseUrl).delete('/api/tanks/unknown');
    const tankCreate = await request(baseUrl).post('/api/tanks')
      .send({ tank: { name: 'Tank', code: 'shoot();', color: 'teal' } });

    expect((await request(baseUrl).get('/api/auth/me')).status).toBe(401);
    expect((await request(baseUrl).get('/api/tanks')).status).toBe(401);
    expect((await request(baseUrl).get('/api/tanks/all')).status).toBe(401);
    expect(tankUpdate.status).toBe(401);
    expect(tankDelete.status).toBe(401);
    expect(tankCreate.status).toBe(401);
  });

  test('prevents non-owners from updating or deleting tanks', async () => {
    const owner = createAccountDetails();
    const otherUser = createAccountDetails();
    const ownerCookie = getAuthCookie(
      await request(baseUrl).post('/api/auth/create').send(owner),
    );
    const otherCookie = getAuthCookie(
      await request(baseUrl).post('/api/auth/create').send(otherUser),
    );
    const created = await request(baseUrl).post('/api/tanks')
      .set('Cookie', ownerCookie)
      .send({ tank: { name: 'Private', code: 'shoot();', color: 'teal' } });
    const tankId = created.body.id;
    const hiddenFromOwnedList = await request(baseUrl).get('/api/tanks').set('Cookie', otherCookie);
    const communityTanks = await request(baseUrl).get('/api/tanks/all').set('Cookie', otherCookie);
    const update = await request(baseUrl).put(`/api/tanks/${tankId}`)
      .set('Cookie', otherCookie)
      .send({ tank: { name: 'Stolen', code: 'shoot();', color: 'red' } });
    const deletion = await request(baseUrl).delete(`/api/tanks/${tankId}`).set('Cookie', otherCookie);

    expect(created.status).toBe(201);
    expect(hiddenFromOwnedList.body).toEqual([]);
    expect(communityTanks.body.some((tank) => tank.id === tankId)).toBe(true);
    expect(update.status).toBe(403);
    expect(deletion.status).toBe(403);
    expect((await request(baseUrl).get('/api/tanks').set('Cookie', ownerCookie)).body[0].name).toBe('Private');
  });
});
