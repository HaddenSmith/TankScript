import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { createAccountDetails, getAuthCookie } from '../helpers/apiFixtures.cjs';
import { startLiveService, stopLiveService } from '../helpers/liveService.cjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
      language: 'javascript',
      color: '#aabbcc',
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
      .send({ tank: { name: 'Updated', code: 'moveUp();', color: '#abcdef' } });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      name: 'Updated',
      color: '#abcdef',
    });
    expect((await request(baseUrl).get('/api/tanks').set('Cookie', cookie)).body[0].color)
      .toBe('#abcdef');

    const deleted = await request(baseUrl).delete(`/api/tanks/${created.body.id}`).set('Cookie', cookie);
    expect(deleted.status).toBe(204);
    expect((await request(baseUrl).get('/api/tanks').set('Cookie', cookie)).body).toEqual([]);
    expect((await request(baseUrl).delete(`/api/tanks/${created.body.id}`).set('Cookie', cookie)).status).toBe(404);
  });

  test.each([
    ['typescript', 'const ready: boolean = true; if (ready) shoot();'],
    ['python', 'ready = True\nif ready:\n    shoot()'],
  ])('saves, loads, and edits original %s without storing generated output', async (language, source) => {
    const created = await request(baseUrl).post('/api/tanks').set('Cookie', cookie).send({
      tank: { name: 'Typed', code: source, language, color: '#317d84', compiledCode: 'ignore this' },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: source, language });
    expect(created.body.compiledCode).toBeUndefined();
    try {
      for (const endpoint of ['/api/tanks', '/api/tanks/all']) {
        const loaded = await request(baseUrl).get(endpoint).set('Cookie', cookie);
        expect(loaded.body.find((tank) => tank.id === created.body.id)).toMatchObject({ code: source, language });
      }
      const updatedSource = source + (language === 'python' ? '\nmove_up()' : '\nmoveUp();');
      const updated = await request(baseUrl).put(`/api/tanks/${created.body.id}`).set('Cookie', cookie).send({
        tank: { name: 'Typed', code: updatedSource, language, color: '#317d84' },
      });
      expect(updated.status).toBe(200);
      const loaded = await request(baseUrl).get('/api/tanks').set('Cookie', cookie);
      expect(loaded.body.find((tank) => tank.id === created.body.id)).toMatchObject({ code: updatedSource, language });
    } finally {
      await request(baseUrl).delete(`/api/tanks/${created.body.id}`).set('Cookie', cookie);
    }
  });

  test('returns JavaScript for legacy MongoDB tanks without a language field', async () => {
    const created = await request(baseUrl).post('/api/tanks').set('Cookie', cookie).send({
      tank: { name: 'Legacy', code: 'shoot();', color: '#317d84' },
    });
    expect(created.status).toBe(201);
    try {
      await execFileAsync(process.execPath, ['tests/helpers/legacyTankFixture.mjs', created.body.id], {
        timeout: 15000,
      });
      for (const endpoint of ['/api/tanks', '/api/tanks/all']) {
        const loaded = await request(baseUrl).get(endpoint).set('Cookie', cookie);
        expect(loaded.body.find((tank) => tank.id === created.body.id)).toMatchObject({ language: 'javascript', code: 'shoot();' });
      }
      const changed = await request(baseUrl).put(`/api/tanks/${created.body.id}`).set('Cookie', cookie)
        .send({ tank: { name: 'Legacy', code: 'shoot()', color: '#317d84', language: 'python' } });
      expect(changed.status).toBe(400);
      const edited = await request(baseUrl).put(`/api/tanks/${created.body.id}`).set('Cookie', cookie)
        .send({ tank: { name: 'Legacy edited', code: 'moveUp();', color: '#317d84' } });
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({ language: 'javascript', code: 'moveUp();' });
    } finally {
      await request(baseUrl).delete(`/api/tanks/${created.body.id}`).set('Cookie', cookie);
    }
  });

  test.each(['javascript', 'typescript', 'python'])('keeps saved %s immutable while allowing source edits', async (language) => {
    const tank = { name: 'Permanent', code: 'original source', color: '#317d84', language };
    const created = await request(baseUrl).post('/api/tanks').set('Cookie', cookie).send({ tank });
    expect(created.status).toBe(201);
    const endpoint = `/api/tanks/${created.body.id}`;
    try {
      for (const replacement of ['javascript', 'typescript', 'python'].filter(value => value !== language)) {
        const rejected = await request(baseUrl).put(endpoint).set('Cookie', cookie)
          .send({ tank: { ...tank, name: 'Changed', code: 'replacement source', language: replacement } });
        expect(rejected.status).toBe(400);
        expect(rejected.body.msg).toContain('language cannot be changed');
        const saved = (await request(baseUrl).get('/api/tanks').set('Cookie', cookie)).body;
        expect(saved.find(value => value.id === created.body.id)).toMatchObject(tank);
      }
      for (const includeLanguage of [true, false]) {
        const edit = { name: 'Edited', code: 'edited source', color: '#abcdef' };
        if (includeLanguage) edit.language = language;
        const updated = await request(baseUrl).put(endpoint).set('Cookie', cookie).send({ tank: edit });
        expect(updated.status).toBe(200);
        expect(updated.body).toMatchObject({ ...edit, language });
        const saved = (await request(baseUrl).get('/api/tanks').set('Cookie', cookie)).body;
        expect(saved.find(value => value.id === created.body.id)).toMatchObject({ ...edit, language });
      }
    } finally {
      await request(baseUrl).delete(endpoint).set('Cookie', cookie);
    }
  });

  test.each(['ruby', 'java', 'TypeScript', '', null, {}, []])('rejects unsupported languages (%j)', async (language) => {
    const response = await request(baseUrl).post('/api/tanks').set('Cookie', cookie).send({
      tank: { name: 'Unsupported', code: 'shoot();', language, color: '#317d84' },
    });
    expect(response.status).toBe(400);
    expect(response.body.msg).toContain('language');
  });

  test.each([
    [{ name: '', code: 'shoot();', color: '#317d84' }],
    [{ name: 'Tank', code: '', color: '#317d84' }],
    [{ name: 'Tank', code: 'shoot();', color: 'teal' }],
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
