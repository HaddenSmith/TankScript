/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { Login } from '../../../frontend/src/login/login.jsx';
import { Register } from '../../../frontend/src/register/register.jsx';
import { createAccount, login } from '../../../frontend/src/services/api.js';

jest.mock('../../../frontend/src/components/ScrambleText.jsx', () => ({
  ScrambleText: ({ text }) => <span>{text}</span>,
}));
jest.mock('../../../frontend/src/services/api.js', () => ({
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
    expect(screen.queryByRole('list', { name: 'Password requirements' })).not.toBeInTheDocument();
    expect(screen.queryByText('Re-enter your password')).not.toBeInTheDocument();
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

  test('shows the password checklist above Username with neutral indicators before typing', () => {
    render(<MemoryRouter><Register onUsernameChange={onUsernameChange} /></MemoryRouter>);
    const requirements = screen.getByRole('list', { name: 'Password requirements' });
    const items = within(requirements).getAllByRole('listitem');

    expect(requirements.compareDocumentPosition(screen.getByLabelText('Username')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('At least 8 characters');
    expect(items[1]).toHaveTextContent('At least 1 letter (A–Z, a–z)');
    expect(items[2]).toHaveTextContent('At least one number');
    for (const item of items) {
      expect(within(item).getByText('○')).toBeInTheDocument();
      expect(item).toHaveTextContent('incomplete');
    }
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(/At least 8 characters.*incomplete/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('adds and removes requirement checkmarks as the password changes', () => {
    render(<MemoryRouter><Register onUsernameChange={onUsernameChange} /></MemoryRouter>);
    const password = screen.getByLabelText('Password');
    const requirements = screen.getByRole('list', { name: 'Password requirements' });
    const [minimum, letter, number] = within(requirements).getAllByRole('listitem');

    fireEvent.change(password, { target: { value: 'abcdefg1' } });
    for (const item of [minimum, letter, number]) {
      expect(within(item).getByText('✓')).toHaveClass('text-success');
      expect(item).toHaveTextContent(', met');
    }

    fireEvent.change(password, { target: { value: 'abcdefg' } });
    expect(within(minimum).getByText('○')).toBeInTheDocument();
    expect(within(number).getByText('○')).toBeInTheDocument();
    expect(within(letter).getByText('✓')).toBeInTheDocument();

    fireEvent.change(password, { target: { value: '12345678' } });
    expect(within(letter).getByText('○')).toBeInTheDocument();
    expect(within(number).getByText('✓')).toBeInTheDocument();

    fireEvent.change(password, { target: { value: 'A1234567' } });
    expect(within(letter).getByText('✓')).toBeInTheDocument();
  });

  test('updates confirmation feedback when either password changes', () => {
    render(<MemoryRouter><Register onUsernameChange={onUsernameChange} /></MemoryRouter>);
    const password = screen.getByLabelText('Password');
    const confirmation = screen.getByLabelText('Confirm Password');
    const feedback = screen.getByRole('status');

    expect(feedback).toHaveTextContent('Re-enter your password');
    expect(within(feedback).getByText('○')).toBeInTheDocument();
    expect(feedback).not.toHaveTextContent('Passwords match');
    fireEvent.change(confirmation, { target: { value: 'securepass123' } });
    expect(feedback).toHaveTextContent('Passwords do not match');

    fireEvent.change(password, { target: { value: 'securepass123' } });
    expect(feedback).toHaveTextContent('Passwords match');
    expect(within(feedback).getByText('✓')).toHaveClass('text-success');
    expect(confirmation).toHaveAccessibleDescription('Passwords match');

    fireEvent.change(password, { target: { value: 'securepass12' } });
    expect(feedback).toHaveTextContent('Passwords do not match');
    fireEvent.change(confirmation, { target: { value: 'securepass12' } });
    expect(feedback).toHaveTextContent('Passwords match');
    fireEvent.change(confirmation, { target: { value: '' } });
    expect(feedback).toHaveTextContent('Re-enter your password');
    expect(within(feedback).queryByText('✓')).not.toBeInTheDocument();
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

  test('enforces the password length limit at submission', () => {
    render(<MemoryRouter><Register onUsernameChange={onUsernameChange} /></MemoryRouter>);
    const longPassword = 'A1' + 'x'.repeat(127);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Pilot_One' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pilot@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: longPassword } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: longPassword } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Password must be no more than 128 characters.');
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

  test('shows a registration API error and allows another submission', async () => {
    createAccount.mockResolvedValue({ ok: false, error: 'This username is already taken.' });
    render(<MemoryRouter><Register onUsernameChange={onUsernameChange} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Pilot_One' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pilot@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'securepass123' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'securepass123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This username is already taken.');
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeEnabled();
    expect(onUsernameChange).not.toHaveBeenCalled();
  });
});
