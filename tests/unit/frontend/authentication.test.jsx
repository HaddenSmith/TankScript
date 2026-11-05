/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { Login } from '../../../src/login/login.jsx';
import { Register } from '../../../src/register/register.jsx';
import { createAccount, login } from '../../../src/services/api.js';

jest.mock('../../../src/components/ScrambleText.jsx', () => ({
  ScrambleText: ({ text }) => <span>{text}</span>,
}));
jest.mock('../../../src/services/api.js', () => ({
  createAccount: jest.fn(),
  login: jest.fn(),
}));

describe('authentication forms', () => {
  const onUsernameChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('requires both login fields before calling the API', () => {
    render(<MemoryRouter><Login onUsernameChange={onUsernameChange} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Please enter a username or email and password.');
    expect(login).not.toHaveBeenCalled();
  });

  test('logs in and reports the authenticated username', async () => {
    login.mockResolvedValue({
      ok: true,
      data: { username: 'Pilot_One' },
    });
    render(<MemoryRouter><Login onUsernameChange={onUsernameChange} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Username or email'), { target: { value: 'pilot@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(onUsernameChange).toHaveBeenCalledWith('Pilot_One'));
    expect(login).toHaveBeenCalledWith('pilot@example.test', 'secret');
    expect(screen.getByRole('alert')).toHaveTextContent('Login successful');
  });

  test('shows an authentication error when login is rejected', async () => {
    login.mockResolvedValue({
      ok: false,
      error: 'Incorrect username/email or password.',
    });
    render(<MemoryRouter><Login onUsernameChange={onUsernameChange} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Username or email'), { target: { value: 'pilot@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrongpass1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username/email or password.');
    expect(onUsernameChange).not.toHaveBeenCalled();
  });

  test('validates registration password confirmation without making a request', () => {
    render(<MemoryRouter><Register onUsernameChange={onUsernameChange} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Pilot_One' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pilot@example.test' } });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'securepass123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'different123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.');
    expect(createAccount).not.toHaveBeenCalled();
  });

  test('registers valid account data and updates the username', async () => {
    createAccount.mockResolvedValue({ ok: true, data: { username: 'Pilot_One' } });
    render(<MemoryRouter><Register onUsernameChange={onUsernameChange} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Pilot_One' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pilot@example.test' } });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'securepass123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'securepass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => expect(onUsernameChange).toHaveBeenCalledWith('Pilot_One'));
    expect(createAccount).toHaveBeenCalledWith('pilot@example.test', 'Pilot_One', 'securepass123');
  });
});
