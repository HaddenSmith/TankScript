/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import App from '../../../frontend/src/app.jsx';
import { getCurrentUser, logout } from '../../../frontend/src/services/api.js';

jest.mock('../../../frontend/src/services/api.js', () => ({
  getCurrentUser: jest.fn(),
  logout: jest.fn(),
}));
jest.mock('../../../frontend/src/components/ScrambleText.jsx', () => ({
  ScrambleText: ({ text }) => text,
}));
jest.mock('../../../frontend/src/home/home.jsx', () => ({ Home: () => null }));
jest.mock('../../../frontend/src/login/login.jsx', () => ({ Login: () => null }));
jest.mock('../../../frontend/src/register/register.jsx', () => ({ Register: () => null }));
jest.mock('../../../frontend/src/tank-editor/tank-editor.jsx', () => ({ TankEditor: () => null }));
jest.mock('../../../frontend/src/battle/battle.jsx', () => ({ Battle: () => null }));
jest.mock('../../../frontend/src/about/about.jsx', () => ({ About: () => null }));

describe('application authentication routing', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  afterEach(() => jest.clearAllMocks());

  test('restores a logged-out session and protects the Tank Editor route', async () => {
    getCurrentUser.mockResolvedValue({ ok: false });
    window.history.pushState({}, '', '/tank-editor');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Log in required' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('link', { name: 'Tank Editor' })).not.toBeInTheDocument();
  });

  test('restores a logged-in user, shows private navigation, and logs out', async () => {
    getCurrentUser.mockResolvedValue({ ok: true, data: { username: 'Pilot_One' } });
    logout.mockResolvedValue({ ok: true });

    render(<App />);

    expect(await screen.findByRole('link', { name: 'Tank Editor' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Battle' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Login' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('You have been logged out.'));
    expect(screen.queryByRole('link', { name: 'Tank Editor' })).not.toBeInTheDocument();
  });
});
