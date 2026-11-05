/** @jest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { Battle } from '../../../src/battle/battle.jsx';
import { getAllTanks } from '../../../src/services/api.js';

jest.mock('../../../src/game/builtInTanks/builtInTanks.js', () => ({
  builtInTanks: [
    { id: 'overkill', name: 'Checkmate (Overkill)', difficulty: 'overkill', color: 'magenta', code: '' },
    { id: 'expert', name: 'Prism (Expert)', difficulty: 'expert', color: 'purple', code: '' },
    { id: 'hard', name: 'Sidewinder (Hard)', difficulty: 'hard', color: 'orange', code: '' },
    { id: 'medium', name: 'Bloodhound (Medium)', difficulty: 'medium', color: 'green', code: '' },
    { id: 'easy', name: 'Firefly (Easy)', difficulty: 'easy', color: 'teal', code: '' },
  ],
}));
jest.mock('../../../src/services/api.js', () => ({
  getAllTanks: jest.fn(),
}));
jest.mock('../../../src/components/ScrambleText.jsx', () => ({
  ScrambleText: ({ text }) => text,
}));

describe('battle setup and results', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    getAllTanks.mockResolvedValue({
      ok: true,
      data: [
        { id: 'z', name: 'zeta', ownerUsername: 'Pilot', code: '', color: 'blue' },
        { id: 'a', name: 'Alpha', ownerUsername: 'Pilot', code: '', color: 'red' },
      ],
    });
    window.requestAnimationFrame = (callback) => {
      callback();
      return 1;
    };
    window.matchMedia = () => ({ matches: true });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('sorts community tanks by name and official tanks Easy through Overkill', async () => {
    render(<Battle username="Pilot" />);
    await act(async () => {
      await Promise.resolve();
    });

    const communityOptions = ['Alpha (Pilot)', 'zeta (Pilot)']
      .map((label) => screen.getByText(label));
    expect(communityOptions.map((option) => option.textContent)).toEqual([
      'Alpha (Pilot)',
      'zeta (Pilot)',
    ]);

    const officialOptions = screen.getAllByText(/\((Easy|Medium|Hard|Expert|Overkill)\)$/);
    expect(officialOptions.map((option) => option.textContent)).toEqual([
      'Firefly (Easy)',
      'Bloodhound (Medium)',
      'Sidewinder (Hard)',
      'Prism (Expert)',
      'Checkmate (Overkill)',
    ]);
  });

  test('allows duplicate participants, runs the battle, reports a tie, and resets when edited', async () => {
    render(<Battle username="Pilot" />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
    expect(screen.getByLabelText('2 Firefly (Easy) selected')).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'Start Battle' })).toBeEnabled();

    fireEvent.change(screen.getByLabelText('Battle Speed'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start Battle' }));
    expect(screen.getByText(/Battle started: Tank #1 \(Firefly \(Easy\)\), Tank #2 \(Firefly \(Easy\)\)/))
      .toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(125 * 125);
    });

    expect(screen.getByText('TICK 125 / 1000')).toBeInTheDocument();
    expect(screen.getByText('Draw! No damage for 125 ticks.')).toBeInTheDocument();
    expect(screen.getByText(/Battle ended\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove one Firefly (Easy)' }));

    expect(screen.getByText('TICK 0 / 1000')).toBeInTheDocument();
    expect(screen.getByLabelText('1 Firefly (Easy) selected')).toHaveTextContent('1');
    expect(screen.queryByText(/Battle ended\./)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Battle' })).toBeDisabled();
  });
});
