import request from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { createAccountDetails, getAuthCookie } from '../helpers/apiFixtures.cjs';
import { startLiveService, stopLiveService } from '../helpers/liveService.cjs';

describe('authentication API', () => {
  let baseUrl;

  beforeAll(async () => {
    baseUrl = await startLiveService();
  });

  afterAll(async () => {
    await stopLiveService();
  });

  async function createAccount(details = createAccountDetails()) {
    return request(baseUrl).post('/api/auth/create').send(details);
  }

  test('registers an account, sets a secure HttpOnly cookie, and hides credentials', async () => {
    const details = createAccountDetails();
    const response = await createAccount(details);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ email: details.email, username: details.username });
    expect(JSON.stringify(response.body)).not.toContain('password');
    expect(response.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect(response.headers['set-cookie'][0]).toMatch(/Secure/i);
  });

  test.each([
    [{ username: 'ab' }, /Username must be between/],
    [{ username: 'bad name' }, /Username may only contain/],
    [{ email: 'not-an-email' }, /valid email/],
    [{ password: 'short' }, /at least 8 characters/],
    [{ password: 'letters-only' }, /letter and one number/],
  ])('validates account input %#', async (invalidFields, expectedMessage) => {
    const response = await createAccount({ ...createAccountDetails(), ...invalidFields });

    expect(response.status).toBe(400);
    expect(response.body.msg).toMatch(expectedMessage);
  });

  test('rejects concurrent duplicate emails and usernames', async () => {
    const details = createAccountDetails();
    const duplicateEmail = await Promise.all([
      createAccount(details),
      createAccount({ ...details, username: `${details.username}_other` }),
    ]);
    expect(duplicateEmail.filter((response) => response.status === 201)).toHaveLength(1);
    expect(duplicateEmail.filter((response) => response.status === 409)).toHaveLength(1);

    const sharedUsername = createAccountDetails().username;
    const duplicateUsername = await Promise.all([
      createAccount({ ...createAccountDetails(), username: sharedUsername }),
      createAccount({ ...createAccountDetails(), username: sharedUsername }),
    ]);
    expect(duplicateUsername.filter((response) => response.status === 201)).toHaveLength(1);
    expect(duplicateUsername.filter((response) => response.status === 409)).toHaveLength(1);
  });

  test('logs in by username and email, restores sessions, and rotates tokens', async () => {
    const details = createAccountDetails();
    const created = await createAccount(details);
    const oldCookie = getAuthCookie(created);
    const usernameLogin = await request(baseUrl).post('/api/auth/login')
      .send({ loginIdentifier: details.username, password: details.password });
    const currentCookie = getAuthCookie(usernameLogin);
    const session = await request(baseUrl).get('/api/auth/me').set('Cookie', currentCookie);
    const emailLogin = await request(baseUrl).post('/api/auth/login')
      .send({ loginIdentifier: details.email, password: details.password });

    expect(usernameLogin.status).toBe(200);
    expect(session.body).toEqual({ email: details.email, username: details.username });
    expect(emailLogin.status).toBe(200);
    expect(emailLogin.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect((await request(baseUrl).get('/api/auth/me').set('Cookie', currentCookie)).status).toBe(401);
    expect((await request(baseUrl).get('/api/auth/me').set('Cookie', oldCookie)).status).toBe(401);
  });

  test('rejects incorrect credentials and logout invalidates tokens', async () => {
    const details = createAccountDetails();
    const created = await createAccount(details);
    const cookie = getAuthCookie(created);
    const badLogin = await request(baseUrl).post('/api/auth/login')
      .send({ loginIdentifier: details.username, password: 'incorrectpass1' });
    const logout = await request(baseUrl).delete('/api/auth/logout').set('Cookie', cookie);
    const afterLogout = await request(baseUrl).get('/api/auth/me').set('Cookie', cookie);

    expect(badLogin.status).toBe(401);
    expect(logout.status).toBe(204);
    expect(afterLogout.status).toBe(401);
  });
});
