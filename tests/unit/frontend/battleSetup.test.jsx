/** @jest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { Battle } from '../../../src/battle/battle.jsx';
import { getAllTanks } from '../../../src/services/api.js';
import { createTankScriptBattleRunner } from '../../../src/game/tank-script/tankScriptWorkerRunner.js';
import { BattleEngine } from '../../../src/game/engine/battleEngine.js';

jest.mock('../../../src/game/builtInTanks/builtInTanks.js', () => ({
  builtInTanks: [
    { id: 'overkill', name: 'Checkmate (Overkill)', difficulty: 'overkill', color: '#b84579', code: '' },
    { id: 'expert', name: 'Prism (Expert)', difficulty: 'expert', color: '#7952a3', code: '' },
    { id: 'hard', name: 'Sidewinder (Hard)', difficulty: 'hard', color: '#d97927', code: '' },
    { id: 'medium', name: 'Bloodhound (Medium)', difficulty: 'medium', color: '#31834a', code: '' },
    { id: 'easy', name: 'Firefly (Easy)', difficulty: 'easy', color: '#317d84', code: '' },
  ],
}));
jest.mock('../../../src/game/tank-script/tankScriptWorkerRunner.js', () => ({
  createTankScriptBattleRunner: jest.fn(),
}));
jest.mock('../../../src/services/api.js', () => ({
  getAllTanks: jest.fn(),
}));
jest.mock('../../../src/components/ScrambleText.jsx', () => ({
  ScrambleText: ({ text }) => text,
}));

const runTick = jest.fn();
const dispose = jest.fn();

async function advance(ms) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
}

async function startBattle() {
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start Battle' })));
}

describe('battle setup and results', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    runTick.mockReset().mockImplementation(async (states) => ({ results: states.map(({ tankId }) => ({ tankId })) }));
    dispose.mockReset().mockResolvedValue(undefined);
    createTankScriptBattleRunner.mockReset().mockResolvedValue({ runTick, dispose });
    getAllTanks.mockResolvedValue({
      ok: true,
      data: [
        { id: 'z', name: 'zeta', ownerUsername: 'Pilot', code: '', color: '#23496b' },
        { id: 'a', name: 'Alpha', ownerUsername: 'Pilot', code: '', color: '#c94a4a' },
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
    expect(screen.getByText('Alpha (Pilot)').closest('.battle-tank-option')
      .querySelector('.battle-roster-swatch'))
      .toHaveStyle({ backgroundColor: '#c94a4a' });

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
    await startBattle();
    expect(screen.getByText(/Battle started: Tank #1 \(Firefly \(Easy\)\), Tank #2 \(Firefly \(Easy\)\)/))
      .toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /Firefly \(Easy\), x/ })[0])
      .toHaveStyle({ '--tank-color': '#317d84' });

    for (let tick = 0; tick < 125; tick++) await advance(125);

    expect(screen.getByText('TICK 125 / 1000')).toBeInTheDocument();
    expect(screen.getByText('Draw! No damage for 125 ticks.')).toBeInTheDocument();
    expect(screen.getByText(/Battle ended\./)).toBeInTheDocument();
    expect(dispose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove one Firefly (Easy)' }));

    expect(screen.getByText('TICK 0 / 1000')).toBeInTheDocument();
    expect(screen.getByLabelText('1 Firefly (Easy) selected')).toHaveTextContent('1');
    expect(screen.queryByText(/Battle ended\./)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Battle' })).toBeDisabled();
  });
  test('sends community code only to the worker and applies one complete batch to the engine', async () => {
    getAllTanks.mockResolvedValue({
      ok: true,
      data: [{ id: 'a', name: 'Alpha', ownerUsername: 'Pilot', code: 'moveRight();', color: '#c94a4a' }],
    });
    runTick.mockResolvedValueOnce({ results: [
      { tankId: 1, command: { action: 'moveRight' } },
      { tankId: 2, error: { code: 'RUNTIME_ERROR' } },
    ] });
    const legacyTick = jest.spyOn(BattleEngine.prototype, 'tick');
    render(<Battle username="Pilot" />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Add one Alpha (Pilot)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
    await startBattle();
    expect(createTankScriptBattleRunner).toHaveBeenCalledWith([
      { tankId: 1, source: 'moveRight();' },
      { tankId: 2, source: '' },
    ], { signal: expect.any(AbortSignal) });

    await advance(500);
    const [first, second] = runTick.mock.calls[0][0];
    expect(first.tankPosition).toEqual({ x: 1, y: 6 });
    expect(second.tankPosition).toEqual({ x: 10, y: 6 });
    expect(first.allTanks).toBe(second.allTanks);
    expect(screen.getByRole('img', { name: /Alpha, x 2, y 6, health 3/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Firefly \(Easy\), x 10, y 6, health 3/ })).toBeInTheDocument();

    await advance(500);
    expect(runTick.mock.calls[1][0][0].tankPosition).toEqual({ x: 2, y: 6 });
    expect(legacyTick).not.toHaveBeenCalled();
  });

  test('keeps one batch in flight across speed changes and applies it once after resume', async () => {
    let finishTick;
    runTick.mockImplementationOnce(() => new Promise((resolve) => { finishTick = resolve; }));
    render(<Battle username="Pilot" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add one Bloodhound (Medium)' }));
    await startBattle();
    await advance(500);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Setup' }));
    fireEvent.change(screen.getByLabelText('Battle Speed'), { target: { value: '0' } });
    await advance(1000);
    expect(runTick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Pause Battle' }));
    await act(async () => finishTick({ results: [{ tankId: 1, command: { action: 'moveRight' } }] }));
    await advance(1000);
    expect(screen.getByText('TICK 0 / 1000')).toBeInTheDocument();
    expect(runTick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Resume Battle' }));
    await advance(0);
    expect(screen.getByText('TICK 1 / 1000')).toBeInTheDocument();
    expect(runTick).toHaveBeenCalledTimes(1);
    await advance(125);
    expect(screen.getByText('TICK 2 / 1000')).toBeInTheDocument();
    expect(runTick).toHaveBeenCalledTimes(2);
  });

  test('aborts initialization on reset and disposes a late runner', async () => {
    let finishStartup;
    createTankScriptBattleRunner.mockImplementationOnce(() => new Promise((resolve) => { finishStartup = resolve; }));
    render(<Battle username="Pilot" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add one Bloodhound (Medium)' }));
    await startBattle();
    const { signal } = createTankScriptBattleRunner.mock.calls[0][1];
    expect(screen.getByText('INITIALIZING TANKSCRIPTS...')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset Battle' }));
    expect(signal.aborted).toBe(true);
    await act(async () => finishStartup({ runTick, dispose }));
    expect(dispose).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(runTick).not.toHaveBeenCalled();
    expect(screen.getByText('TICK 0 / 1000')).toBeInTheDocument();
  });

  test('discards a reset battle response after a new battle starts and aborts on navigation', async () => {
    let finishOldTick;
    let finishNewTick;
    runTick.mockImplementationOnce(() => new Promise((resolve) => { finishOldTick = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishNewTick = resolve; }));
    const { unmount } = render(<Battle username="Pilot" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add one Bloodhound (Medium)' }));
    await startBattle();
    await advance(500);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Battle' }));
    expect(createTankScriptBattleRunner.mock.calls[0][1].signal.aborted).toBe(true);

    await startBattle();
    await advance(500);
    await act(async () => finishOldTick({ results: [{ tankId: 1, command: { action: 'moveRight' } }] }));
    expect(screen.getByText('TICK 0 / 1000')).toBeInTheDocument();
    expect(runTick).toHaveBeenCalledTimes(2);
    unmount();
    expect(createTankScriptBattleRunner.mock.calls[1][1].signal.aborted).toBe(true);
    await act(async () => finishNewTick({ results: [] }));
    expect(runTick).toHaveBeenCalledTimes(2);
  });

  test('stops safely after a worker failure without advancing the tick', async () => {
    const error = new Error('Worker failed');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    runTick.mockRejectedValueOnce(error);
    render(<Battle username="Pilot" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add one Bloodhound (Medium)' }));
    await startBattle();
    await advance(500);

    expect(screen.getByRole('alert')).toHaveTextContent('The TankScript runner stopped.');
    expect(screen.getByText('TICK 0 / 1000')).toBeInTheDocument();
    expect(createTankScriptBattleRunner.mock.calls[0][1].signal.aborted).toBe(true);
    await advance(1000);
    expect(runTick).toHaveBeenCalledTimes(1);
  });

});
