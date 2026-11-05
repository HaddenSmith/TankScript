import { afterEach, describe, expect, jest, test } from '@jest/globals';
import {
  deleteTank,
  generateTankNames,
  getCurrentUser,
} from '../../../src/services/api.js';

describe('frontend API service', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('converts successful and unsuccessful JSON responses into the public result shape', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ username: 'Pilot' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ msg: 'Sign in required.' }),
      });

    await expect(getCurrentUser()).resolves.toEqual({
      ok: true,
      status: 200,
      data: { username: 'Pilot' },
      error: null,
    });
    await expect(deleteTank('tank-1')).resolves.toEqual({
      ok: false,
      status: 401,
      data: null,
      error: 'Sign in required.',
    });
  });

  test('handles no-content and network responses', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockRejectedValueOnce(new Error('offline'));

    await expect(deleteTank('tank-1')).resolves.toEqual({
      ok: true,
      status: 204,
      data: null,
      error: null,
    });
    await expect(getCurrentUser()).resolves.toMatchObject({
      ok: false,
      status: 0,
      error: 'Unable to connect to the server.',
    });
  });

  test('normalizes and deduplicates successful CueName suggestions', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        names: [{ name: ' Ember ' }, { name: 'ember' }, { name: '' }, { name: 'Frost' }],
      }),
    });

    await expect(generateTankNames()).resolves.toEqual({
      ok: true,
      status: 200,
      data: { names: ['Ember', 'Frost'] },
      error: null,
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://cuename.com/api/generate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('surfaces CueName API and network failures without throwing', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Name service unavailable.' }),
      })
      .mockRejectedValueOnce(new Error('offline'));

    await expect(generateTankNames()).resolves.toMatchObject({
      ok: false,
      status: 503,
      error: 'Name service unavailable.',
    });
    await expect(generateTankNames()).resolves.toMatchObject({
      ok: false,
      status: 0,
      error: 'Unable to connect to CueName. Please try again.',
    });
  });
});
