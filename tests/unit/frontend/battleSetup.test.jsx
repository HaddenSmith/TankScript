/** @jest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { Battle } from '../../../frontend/src/battle/battle.jsx';
import { getAllTanks } from '../../../frontend/src/services/api.js';
import { createTankScriptBattleRunner } from '../../../frontend/src/game/tank-script/shared/tankScriptWorkerRunner.js';
import { BattleEngine } from '../../../frontend/src/game/engine/battleEngine.js';
import { Arena } from '../../../frontend/src/game/engine/arena.js';
import { Heart } from '../../../frontend/src/game/engine/heart.js';
import { Lightning } from '../../../frontend/src/game/engine/lightning.js';
import { TankScriptCompileError } from '../../../frontend/src/game/tank-script/shared/tankScriptRunnerProtocol.js';

jest.mock('../../../frontend/src/game/builtInTanks/builtInTanks.js', () => ({
  builtInTanks: [
    { id: 'overkill', name: 'Checkmate (Overkill)', difficulty: 'overkill', color: '#b84579', code: '' },
    { id: 'expert', name: 'Prism (Expert)', difficulty: 'expert', color: '#7952a3', code: '' },
    { id: 'hard', name: 'Sidewinder (Hard)', difficulty: 'hard', color: '#d97927', code: '' },
    { id: 'medium', name: 'Bloodhound (Medium)', difficulty: 'medium', color: '#31834a', code: '' },
    { id: 'easy', name: 'Firefly (Easy)', difficulty: 'easy', color: '#317d84', code: '' },
  ],
}));
jest.mock('../../../frontend/src/game/tank-script/shared/tankScriptWorkerRunner.js', () => ({
  createTankScriptBattleRunner: jest.fn(),
}));
jest.mock('../../../frontend/src/services/api.js', () => ({
  getAllTanks: jest.fn(),
}));
jest.mock('../../../frontend/src/components/ScrambleText.jsx', () => ({
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
  test.each([[false, false], [true, false], [false, true], [true, true]])(
    'keeps wall (%s) and power-up (%s) settings independent through starts and resets', async (walls, powerups) => {
      const spawn = jest.spyOn(Arena.prototype, 'spawnPowerups');
      render(<Battle username="Pilot" />);
      await act(async () => {});
      expect(screen.getByLabelText('Enable Power-Ups')).not.toBeChecked();
      expect(screen.getByLabelText('Enable Walls')).not.toBeChecked();
      fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
      if (walls) fireEvent.click(screen.getByLabelText('Enable Walls'));
      if (powerups) fireEvent.click(screen.getByLabelText('Enable Power-Ups'));
      await startBattle();
      expect(spawn).not.toHaveBeenCalled();
      await advance(500);
      expect(spawn).toHaveBeenCalledTimes(powerups ? 1 : 0);
      expect(document.querySelectorAll('.battle-powerup').length).toBe(powerups ? 2 : 0);
      expect(document.querySelectorAll('.battle-wall').length > 0).toBe(walls);
      fireEvent.click(screen.getByRole('button', { name: 'Reset Battle' }));
      expect(document.querySelector('.battle-powerup')).toBeNull();
      expect(screen.getByLabelText('Enable Power-Ups').checked).toBe(powerups);
      expect(screen.getByLabelText('Enable Walls').checked).toBe(walls);
      expect(screen.getByLabelText('2 Firefly (Easy) selected')).toBeInTheDocument();
      await startBattle();
      await advance(500);
      expect(spawn).toHaveBeenCalledTimes(powerups ? 2 : 0);
      fireEvent.click(screen.getByRole('button', { name: 'Edit Setup' }));
      fireEvent.click(screen.getByLabelText('Enable Power-Ups'));
      expect(screen.getByText('TICK 0 / 1000')).toBeInTheDocument();
      expect(screen.getByLabelText('Enable Walls').checked).toBe(walls);
      await startBattle();
      await advance(500);
      expect(document.querySelectorAll('.battle-powerup').length).toBe(powerups ? 0 : 2);
    },
  );

  test('shows health recovery and the lightning countdown from actual engine resolution', async () => {
    jest.spyOn(Arena.prototype, 'spawnPowerups').mockImplementation(function () {
      this.addHeart(new Heart(0, 5));
      this.addLightning(new Lightning(1, 5));
    });
    const actions = ['moveLeft', 'moveLeft', 'moveUp', 'moveRight'];
    let tick = 0;
    runTick.mockImplementation(async states => {
      const action = actions[tick++];
      return { results: states.map(({ tankId }) => ({ tankId, command: tankId === 1 ? { action } : undefined })) };
    });
    render(<Battle username="Pilot" />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
    fireEvent.click(screen.getByLabelText('Enable Power-Ups'));
    await startBattle();
    await advance(500);
    await advance(500);
    expect(screen.getByRole('img', { name: /Firefly.*x 0, y 6, health 2/ })).toBeInTheDocument();
    await advance(500);
    expect(screen.getByRole('img', { name: /Firefly.*x 0, y 5, health 3/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Heart, x/ })).toBeNull();
    await advance(500);
    expect(screen.getByText(/Bullet speed ×2.*Lightning: 50 ticks remaining/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Firefly.*lightning upgrade/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Lightning, x/ })).toBeNull();
  });

  test('freezes lightning while paused, resumes by game tick, resets cleanly and hides the expired indicator', async () => {
    jest.spyOn(Arena.prototype, 'spawnPowerups').mockImplementation(function () {
      this.addLightning(new Lightning(2, 6));
    });
    runTick.mockImplementation(async states => ({ results: states.map(state => ({
      tankId: state.tankId,
      command: state.tankId === 1 && state.tankPosition.x === 1 ? { action: 'moveRight' } : undefined,
    })) }));
    render(<Battle username="Pilot" />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
    fireEvent.click(screen.getByLabelText('Enable Power-Ups'));
    await startBattle();
    await advance(500);
    expect(screen.getByText(/Lightning: 50 ticks remaining/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pause Battle' }));
    await advance(60000);
    expect(screen.getByText('TICK 1 / 1000')).toBeInTheDocument();
    expect(screen.getByText(/Lightning: 50 ticks remaining/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume Battle' }));
    await advance(500);
    expect(screen.getByText(/Lightning: 49 ticks remaining/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset Battle' }));
    expect(document.querySelector('.battle-tank__lightning')).toBeNull();
    await startBattle();
    expect(screen.queryByText(/Lightning:.*remaining/)).toBeNull();
    await advance(500);
    expect(screen.getByText(/Lightning: 50 ticks remaining/)).toBeInTheDocument();
    for (let tick = 0; tick < 49; tick++) await advance(500);
    expect(screen.getByText('TICK 50 / 1000')).toBeInTheDocument();
    expect(screen.getByText(/Lightning: 1 tick remaining/)).toBeInTheDocument();
    await advance(500);
    expect(screen.getByText('TICK 51 / 1000')).toBeInTheDocument();
    expect(document.querySelector('.battle-tank__lightning')).toBeNull();
    expect(screen.queryByText(/Lightning:.*remaining/)).toBeNull();
    expect(screen.queryByRole('img', { name: /lightning upgrade/ })).toBeNull();
  });
  test('defaults to wall-free battles and preserves the wall option and roster across resets', async () => {
    const generateWalls = jest.spyOn(Arena.prototype, 'generateWalls');
    render(<Battle username="Pilot" />);
    await act(async () => {});
    expect(screen.getByRole('checkbox', { name: 'Enable Walls' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
    await startBattle();
    expect(generateWalls).not.toHaveBeenCalled();
    expect(document.querySelector('.battle-wall')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reset Battle' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Walls' }));
    await startBattle();
    expect(generateWalls).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('img', { name: /Wall, x/ }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Walls enabled/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset Battle' }));
    expect(document.querySelector('.battle-wall')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Enable Walls' })).toBeChecked();
    expect(screen.getByLabelText('2 Firefly (Easy) selected')).toBeInTheDocument();
    await startBattle();
    expect(generateWalls).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('img', { name: /Wall, x/ }).every(node => node.title === 'Wall: 10 / 10 HP')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Setup' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Walls' }));
    expect(screen.getByText('TICK 0 / 1000')).toBeInTheDocument();
    expect(document.querySelector('.battle-wall')).toBeNull();
    await startBattle();
    expect(generateWalls).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.battle-wall')).toBeNull();
  });
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

  test('shows actual language logos in available/selected rows and live participant information', async () => {
    getAllTanks.mockResolvedValue({ ok: true, data: [
      { id: 'typed', name: 'Typed', ownerUsername: 'Pilot', code: '', language: 'typescript', color: '#317d84' },
      { id: 'python', name: 'Python', ownerUsername: 'Pilot', code: '', language: 'python', color: '#317d84' },
      { id: 'legacy', name: 'Legacy', ownerUsername: 'Pilot', code: '', color: '#317d84' },
    ] });
    render(<Battle username="Pilot" />);
    await act(async () => {});
    for (const [name, language] of [['Typed', 'TypeScript'], ['Python', 'Python'], ['Legacy', 'JavaScript']]) {
      const row = screen.getByText(`${name} (Pilot)`).closest('.battle-tank-option');
      expect(within(row).getByRole('img', { name: language })).toHaveAttribute('title', language);
      fireEvent.click(within(row).getByRole('button', { name: `Add one ${name} (Pilot)` }));
      expect(screen.getByLabelText(`1 ${name} (Pilot) selected`)).toBeInTheDocument();
      expect(within(row).getByRole('img', { name: language })).toBeInTheDocument();
    }
    await startBattle();
    for (const [index, name, language] of [[1, 'Typed', 'TypeScript'], [2, 'Python', 'Python'], [3, 'Legacy', 'JavaScript']]) {
      const panel = screen.getByRole('heading', { name: `Tank #${index}: ${name}` }).parentElement;
      expect(within(panel).getByRole('img', { name: language })).toBeInTheDocument();
    }
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

  test('shows the winning tank’s saved language in the result', async () => {
    getAllTanks.mockResolvedValue({ ok: true, data: [
      { id: 'python', name: 'Python', ownerUsername: 'Pilot', code: '', language: 'python', color: '#317d84' },
      { id: 'typed', name: 'Typed', ownerUsername: 'Pilot', code: '', language: 'typescript', color: '#317d84' },
    ] });
    runTick.mockImplementation(async states => ({ results: states.map(({ tankId }) => ({
      tankId, command: tankId === 1 ? { action: 'moveLeft' } : undefined,
    })) }));
    render(<Battle username="Pilot" />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Add one Python (Pilot)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add one Typed (Pilot)' }));
    await startBattle();
    for (let tick = 0; tick < 4; tick++) await advance(500);
    const result = screen.getByRole('heading', { name: 'Battle Results' }).parentElement;
    expect(result).toHaveTextContent('Tank #2 (Typed) wins!');
    expect(within(result).getByRole('img', { name: 'TypeScript' })).toBeInTheDocument();
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
      { tankId: 1, source: 'moveRight();', language: 'javascript' },
      { tankId: 2, source: '', language: 'javascript' },
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

  test('passes mixed languages to the runner and stops before ticking on compilation errors', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    getAllTanks.mockResolvedValue({ ok: true, data: [
      { id: 'typed', name: 'Typed', ownerUsername: 'Pilot', code: 'const n: number = "bad";', language: 'typescript', color: '#317d84' },
    ] });
    createTankScriptBattleRunner.mockRejectedValueOnce(new TankScriptCompileError('Tank #1: TypeScript: Line 1, column 7: Invalid type.'));
    render(<Battle username="Pilot" />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Add one Typed (Pilot)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
    await startBattle();
    expect(createTankScriptBattleRunner).toHaveBeenCalledWith([
      { tankId: 1, source: 'const n: number = "bad";', language: 'typescript' },
      { tankId: 2, source: '', language: 'javascript' },
    ], { signal: expect.any(AbortSignal) });
    expect(screen.getByText(/Tank #1: TypeScript: Line 1, column 7/)).toBeInTheDocument();
    await advance(500);
    expect(runTick).not.toHaveBeenCalled();
    expect(screen.getByText('TICK 0 / 1000')).toBeInTheDocument();
  });

  test('reports Python failures once while healthy participants keep running', async () => {
    getAllTanks.mockResolvedValue({ ok: true, data: [
      { id: 'python', name: 'Python', ownerUsername: 'Pilot', code: 'raise ValueError()', language: 'python', color: '#317d84' },
    ] });
    runTick.mockImplementation(async states => ({ results: states.map(({ tankId }) => tankId === 1
      ? { tankId, error: { code: 'RUNTIME_ERROR', message: 'Python: Line 1: ValueError: broken' } }
      : { tankId, command: { action: 'rotateLeft' } }) }));
    render(<Battle username="Pilot" />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Add one Python (Pilot)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add one Firefly (Easy)' }));
    await startBattle();
    expect(createTankScriptBattleRunner.mock.calls[0][1].onStatus).toEqual(expect.any(Function));
    await advance(500);
    await advance(500);
    expect(screen.getByText('TICK 2 / 1000')).toBeInTheDocument();
    expect(screen.getAllByText(/Tank #1: Python: Line 1: ValueError: broken$/)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Battle' }));
    expect(createTankScriptBattleRunner.mock.calls[0][1].signal.aborted).toBe(true);
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
    await advance(124);
    expect(runTick).toHaveBeenCalledTimes(1);
    await advance(1);
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
