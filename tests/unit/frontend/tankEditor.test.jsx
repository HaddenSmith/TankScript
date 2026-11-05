/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { TankEditor } from '../../../src/tank-editor/tank-editor.jsx';
import {
  createTank,
  deleteTank,
  generateTankNames,
  getTanks,
  updateTank,
} from '../../../src/services/api.js';

jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({ value, onChange }) => (
    <textarea aria-label="Tank code" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
jest.mock('../../../src/services/api.js', () => ({
  createTank: jest.fn(),
  deleteTank: jest.fn(),
  generateTankNames: jest.fn(),
  getTanks: jest.fn(),
  updateTank: jest.fn(),
}));

describe('TankEditor', () => {
  beforeEach(() => {
    getTanks.mockResolvedValue({ ok: true, data: [] });
  });

  afterEach(() => jest.restoreAllMocks());

  test('loads saved tanks and shows the TankScript API reference', async () => {
    getTanks.mockResolvedValue({
      ok: true,
      data: [{ id: 'tank-1', name: 'Ember', color: 'teal', code: 'shoot();' }],
    });

    render(<TankEditor username="Pilot_One" />);

    expect(await screen.findByRole('option', { name: 'Ember' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'TankScript reference' })).toBeInTheDocument();
    expect(screen.getByText("The first action called is that tank's action; each tank submits one."))
      .toBeInTheDocument();
  });

  test('creates a named tank using the selected color and reports missing Monaco checks', async () => {
    createTank.mockResolvedValue({
      ok: true,
      data: { id: 'tank-2', name: '  Ember  ', code: 'shoot();', color: 'blue' },
    });
    render(<TankEditor username="Pilot_One" />);
    fireEvent.change(screen.getByLabelText('Tank name'), { target: { value: '  Ember  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select blue tank color' }));
    fireEvent.change(screen.getByLabelText('Tank code'), { target: { value: 'shoot();' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save New Tank' }));

    await waitFor(() => expect(createTank).toHaveBeenCalledWith({
      name: 'Ember',
      code: 'shoot();',
      color: 'blue',
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tank saved, but Monaco could not check the JavaScript syntax.');
  });

  test('loads a saved tank for editing and updates it', async () => {
    const originalTank = { id: 'tank-1', name: 'Ember', color: 'teal', code: 'shoot();' };
    const updatedTank = { ...originalTank, name: 'Updated Ember', code: 'moveUp();' };
    getTanks.mockResolvedValue({ ok: true, data: [originalTank] });
    updateTank.mockResolvedValue({ ok: true, data: updatedTank });
    render(<TankEditor username="Pilot_One" />);

    fireEvent.change(await screen.findByLabelText('Edit a saved tank'), {
      target: { value: 'tank-1' },
    });
    fireEvent.change(screen.getByLabelText('Tank name'), { target: { value: 'Updated Ember' } });
    fireEvent.change(screen.getByLabelText('Tank code'), { target: { value: 'moveUp();' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Tank' }));

    await waitFor(() => expect(updateTank).toHaveBeenCalledWith('tank-1', {
      name: 'Updated Ember',
      code: 'moveUp();',
      color: 'teal',
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tank updated, but Monaco could not check the JavaScript syntax.');
  });

  test('deletes a selected tank after confirmation', async () => {
    getTanks.mockResolvedValue({
      ok: true,
      data: [{ id: 'tank-1', name: 'Ember', color: 'teal', code: 'shoot();' }],
    });
    deleteTank.mockResolvedValue({ ok: true });
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TankEditor username="Pilot_One" />);

    fireEvent.change(await screen.findByLabelText('Edit a saved tank'), {
      target: { value: 'tank-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Tank' }));

    await waitFor(() => expect(deleteTank).toHaveBeenCalledWith('tank-1'));
    expect(screen.queryByRole('option', { name: 'Ember' })).not.toBeInTheDocument();
    expect(await screen.findByText('Ember was deleted.')).toHaveAttribute('role', 'status');
  });

  test('surfaces CueName errors in the editor', async () => {
    generateTankNames.mockResolvedValue({
      ok: false,
      error: 'CueName is unavailable.',
    });
    render(<TankEditor username="Pilot_One" />);

    fireEvent.click(screen.getByRole('button', { name: 'Suggest Names' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('CueName is unavailable.');
  });
});
