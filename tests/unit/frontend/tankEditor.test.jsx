/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { TankEditor } from '../../../frontend/src/tank-editor/tank-editor.jsx';
import {
  createTank,
  deleteTank,
  generateTankNames,
  getTanks,
  updateTank,
} from '../../../frontend/src/services/api.js';

jest.mock('../../../frontend/src/tank-editor/editor/localMonacoEditor.js', () => ({
  __esModule: true,
  default: ({ value, language, path, onChange }) => (
    <textarea aria-label="Tank code" data-language={language} data-path={path} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
jest.mock('../../../frontend/src/services/api.js', () => ({
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
      data: [{ id: 'tank-1', name: 'Ember', color: '#317d84', code: 'shoot();' }],
    });

    render(<TankEditor username="Pilot_One" />);

    expect(await screen.findByRole('option', { name: 'Ember' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'TankScript reference' })).toBeInTheDocument();
    expect(screen.getByText("The first action called is that tank's action; each tank submits one."))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select teal tank color' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Select custom tank color')).toHaveValue('#8497a4');
    expect(document.querySelector('.tank-color-custom__fill')).toHaveClass('is-rainbow');
  });

  test('creates a named tank using the selected color and reports missing Monaco checks', async () => {
    createTank.mockResolvedValue({
      ok: true,
      data: { id: 'tank-2', name: '  Ember  ', code: 'shoot();', color: '#23496b' },
    });
    render(<TankEditor username="Pilot_One" />);
    fireEvent.change(screen.getByLabelText('Tank name'), { target: { value: '  Ember  ' } });
    const blueSwatch = screen.getByRole('button', { name: 'Select blue tank color' });
    expect(blueSwatch).not.toHaveAttribute('title');
    expect(blueSwatch.querySelector('.tank-color-swatch__fill'))
      .toHaveStyle({ backgroundColor: '#23496b' });
    fireEvent.click(blueSwatch);
    fireEvent.change(await screen.findByLabelText('Tank code'), { target: { value: 'shoot();' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save New Tank' }));

    await waitFor(() => expect(createTank).toHaveBeenCalledWith({
      name: 'Ember',
      code: 'shoot();',
      language: 'javascript',
      color: '#23496b',
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tank saved, but Monaco could not check the JavaScript syntax.');
  });

  test('saves a custom hexadecimal color', async () => {
    createTank.mockResolvedValue({
      ok: true,
      data: { id: 'tank-3', name: 'Ember', code: 'shoot();', color: '#12ab34' },
    });
    render(<TankEditor username="Pilot_One" />);
    fireEvent.change(screen.getByLabelText('Tank name'), { target: { value: 'Ember' } });
    fireEvent.change(await screen.findByLabelText('Tank code'), { target: { value: 'shoot();' } });
    fireEvent.change(screen.getByLabelText('Select custom tank color'), {
      target: { value: '#12ab34' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save New Tank' }));

    await waitFor(() => expect(createTank).toHaveBeenCalledWith({
      name: 'Ember',
      code: 'shoot();',
      language: 'javascript',
      color: '#12ab34',
    }));
    expect(screen.getByLabelText('Select custom tank color')).toHaveValue('#12ab34');
    expect(document.querySelector('.tank-color-custom__fill')).not.toHaveClass('is-rainbow');
  });

  test('loads a saved tank for editing and updates it', async () => {
    const originalTank = { id: 'tank-1', name: 'Ember', color: '#317d84', code: 'shoot();' };
    const updatedTank = { ...originalTank, name: 'Updated Ember', code: 'moveUp();' };
    getTanks.mockResolvedValue({ ok: true, data: [originalTank] });
    updateTank.mockResolvedValue({ ok: true, data: updatedTank });
    render(<TankEditor username="Pilot_One" />);

    await screen.findByRole('option', { name: 'Ember' });
    fireEvent.change(screen.getByLabelText('Edit a saved tank'), {
      target: { value: 'tank-1' },
    });
    fireEvent.change(screen.getByLabelText('Tank name'), { target: { value: 'Updated Ember' } });
    fireEvent.change(await screen.findByLabelText('Tank code'), { target: { value: 'moveUp();' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Tank' }));

    await waitFor(() => expect(updateTank).toHaveBeenCalledWith('tank-1', {
      name: 'Updated Ember',
      code: 'moveUp();',
      language: 'javascript',
      color: '#317d84',
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tank updated, but Monaco could not check the JavaScript syntax.');
  });

  test('deletes a selected tank after confirmation', async () => {
    getTanks.mockResolvedValue({
      ok: true,
      data: [{ id: 'tank-1', name: 'Ember', color: '#317d84', code: 'shoot();' }],
    });
    deleteTank.mockResolvedValue({ ok: true });
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TankEditor username="Pilot_One" />);

    await screen.findByRole('option', { name: 'Ember' });
    fireEvent.change(screen.getByLabelText('Edit a saved tank'), {
      target: { value: 'tank-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Tank' }));

    await waitFor(() => expect(deleteTank).toHaveBeenCalledWith('tank-1'));
    expect(await screen.findByText('Ember was deleted.')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('option', { name: 'Ember' })).not.toBeInTheDocument();
  });

  test('switches Monaco language and preserves separate unsaved drafts', async () => {
    render(<TankEditor username="Pilot_One" />);
    const code = await screen.findByLabelText('Tank code');
    const language = screen.getByLabelText('Language');
    expect(language).toHaveValue('javascript');
    expect(screen.getByRole('option', { name: 'Python — coming soon' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Java — coming soon' })).toBeDisabled();
    fireEvent.change(code, { target: { value: 'moveUp();' } });
    fireEvent.change(language, { target: { value: 'typescript' } });
    expect(code).toHaveAttribute('data-language', 'typescript');
    expect(code).toHaveAttribute('data-path', 'tank.ts');
    fireEvent.change(code, { target: { value: 'const ready: boolean = true; if (ready) shoot();' } });
    fireEvent.change(language, { target: { value: 'javascript' } });
    expect(code).toHaveValue('moveUp();');
    expect(code).toHaveAttribute('data-path', 'tank.js');
    fireEvent.change(language, { target: { value: 'typescript' } });
    expect(code).toHaveValue('const ready: boolean = true; if (ready) shoot();');
  });

  test('creates a TypeScript tank with its original source and selected language', async () => {
    const source = 'const ready: boolean = true; if (ready) shoot();';
    createTank.mockResolvedValue({
      ok: true,
      data: { id: 'typed-1', name: 'Typed', code: source, language: 'typescript', color: '#317d84' },
    });
    render(<TankEditor username="Pilot_One" />);
    fireEvent.change(screen.getByLabelText('Tank name'), { target: { value: 'Typed' } });
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'typescript' } });
    fireEvent.change(await screen.findByLabelText('Tank code'), { target: { value: source } });
    fireEvent.click(screen.getByRole('button', { name: 'Save New Tank' }));
    await waitFor(() => expect(createTank).toHaveBeenCalledWith({
      name: 'Typed', code: source, language: 'typescript', color: '#317d84',
    }));
    expect(screen.getByLabelText('Tank code')).toHaveValue(source);
    expect(await screen.findByRole('alert')).toHaveTextContent('TypeScript code');
  });

  test('loads and edits TypeScript tanks and defaults legacy tanks to JavaScript', async () => {
    const source = 'const health: number = tankHealth; shoot();';
    getTanks.mockResolvedValue({ ok: true, data: [
      { id: 'typed', name: 'Typed', code: source, language: 'typescript', color: '#317d84' },
      { id: 'legacy', name: 'Legacy', code: 'moveDown();', color: '#23496b' },
    ] });
    updateTank.mockResolvedValue({ ok: true, data: {
      id: 'typed', name: 'Typed', code: source + '\nmoveUp();', language: 'typescript', color: '#317d84',
    } });
    render(<TankEditor username="Pilot_One" />);
    await screen.findByRole('option', { name: 'Typed' });
    fireEvent.change(screen.getByLabelText('Edit a saved tank'), { target: { value: 'typed' } });
    expect(screen.getByLabelText('Language')).toHaveValue('typescript');
    const code = await screen.findByLabelText('Tank code');
    expect(code).toHaveValue(source);
    fireEvent.change(code, { target: { value: source + '\nmoveUp();' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Tank' }));
    await waitFor(() => expect(updateTank).toHaveBeenCalledWith('typed', {
      name: 'Typed', code: source + '\nmoveUp();', language: 'typescript', color: '#317d84',
    }));
    fireEvent.change(screen.getByLabelText('Edit a saved tank'), { target: { value: 'legacy' } });
    expect(screen.getByLabelText('Language')).toHaveValue('javascript');
    expect(code).toHaveValue('moveDown();');
    fireEvent.click(screen.getByRole('button', { name: 'Start New Tank' }));
    expect(screen.getByLabelText('Language')).toHaveValue('javascript');
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'typescript' } });
    expect(code.value).not.toContain('const health');
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
