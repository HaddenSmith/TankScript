/** @jest-environment jsdom */
import React from 'react';
import { openLanguageMenu, selectTankLanguage } from '../../helpers/languageSelector.js';
import starterJavaScriptCode from '../../../frontend/src/tank-editor/editor/starter-code/starterJavaScriptCode.js';
import starterTypeScriptCode from '../../../frontend/src/tank-editor/editor/starter-code/starterTypeScriptCode.js';
import starterPythonCode from '../../../frontend/src/tank-editor/editor/starter-code/starterPythonCode.js';
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

  test('hides saved Java when the frontend flag is off, even from an opted-in backend', async () => {
    getTanks.mockResolvedValue({ok:true,data:[
      {id:'hidden-java',name:'Hidden Java',language:'java',code:'class MyTank {}',color:'#317d84'},
      {id:'visible-js',name:'Visible JavaScript',language:'javascript',code:'shoot();',color:'#317d84'},
    ]});
    render(<TankEditor username="Pilot" />);
    await screen.findByRole('option',{name:'Visible JavaScript'});
    expect(screen.queryByRole('option',{name:'Hidden Java'})).not.toBeInTheDocument();
    await openLanguageMenu();
    expect(screen.getByRole('option',{name:'Java — coming soon'})).toHaveAttribute('aria-disabled','true');
  });

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
    expect(language).toHaveTextContent('JavaScript');
    expect((await openLanguageMenu()).getByRole('option', { name: 'Python', exact: true })).toBeEnabled();
    expect((await openLanguageMenu()).getByRole('option', { name: 'Java — coming soon' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.change(code, { target: { value: 'moveUp();' } });
    await selectTankLanguage('typescript');
    expect(code).toHaveAttribute('data-language', 'typescript');
    expect(code).toHaveAttribute('data-path', 'tank.ts');
    fireEvent.change(code, { target: { value: 'const ready: boolean = true; if (ready) shoot();' } });
    await selectTankLanguage('javascript');
    expect(code).toHaveValue('moveUp();');
    expect(code).toHaveAttribute('data-path', 'tank.js');
    await selectTankLanguage('typescript');
    expect(code).toHaveValue('const ready: boolean = true; if (ready) shoot();');
  });

  test('offers language logos and keeps Java disabled without submitting the form', async () => {
    createTank.mockClear();
    render(<TankEditor username="Pilot_One" />);
    await screen.findByLabelText('Tank code');
    const menu = await openLanguageMenu();
    expect(menu.getByRole('option', { name: 'JavaScript', exact: true })).toHaveAttribute('aria-selected', 'true');
    for (const [name, file] of [['JavaScript', 'javascript'], ['TypeScript', 'typescript'], ['Python', 'python'], ['Java — coming soon', 'java']]) {
      const option = menu.getByRole('option', { name, exact: true });
      expect(option.querySelector('img')).toHaveAttribute('src', `/language-logos/${file}.svg`);
      expect(option).toHaveAttribute('type', 'button');
    }
    const java = menu.getByRole('option', { name: 'Java — coming soon' });
    expect(java).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(java);
    expect(screen.getByLabelText('Language')).toHaveTextContent('JavaScript');
    expect(screen.getByLabelText('Language')).toHaveAttribute('type', 'button');
    expect(createTank).not.toHaveBeenCalled();
  });

  test('loads each original starter from its source module', async () => {
    render(<TankEditor username="Pilot_One" />);
    const code = await screen.findByLabelText('Tank code');
    // Textareas normalize newlines, but the source modules retain the originals.
    expect(code.value).toBe(starterJavaScriptCode.replaceAll('\r\n', '\n'));
    await selectTankLanguage('typescript');
    expect(code.value).toBe(starterTypeScriptCode.replaceAll('\r\n', '\n'));
    await selectTankLanguage('python');
    expect(code.value).toBe(starterPythonCode.replaceAll('\r\n', '\n'));
  });

  test('creates a TypeScript tank with its original source and selected language', async () => {
    const source = 'const ready: boolean = true; if (ready) shoot();';
    createTank.mockResolvedValue({
      ok: true,
      data: { id: 'typed-1', name: 'Typed', code: source, language: 'typescript', color: '#317d84' },
    });
    render(<TankEditor username="Pilot_One" />);
    fireEvent.change(screen.getByLabelText('Tank name'), { target: { value: 'Typed' } });
    await selectTankLanguage('typescript');
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
    expect(screen.getByLabelText('Language')).toHaveTextContent('TypeScript');
    const code = await screen.findByLabelText('Tank code');
    expect(code).toHaveValue(source);
    fireEvent.change(code, { target: { value: source + '\nmoveUp();' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Tank' }));
    await waitFor(() => expect(updateTank).toHaveBeenCalledWith('typed', {
      name: 'Typed', code: source + '\nmoveUp();', language: 'typescript', color: '#317d84',
    }));
    fireEvent.change(screen.getByLabelText('Edit a saved tank'), { target: { value: 'legacy' } });
    expect(screen.getByLabelText('Language')).toHaveTextContent('JavaScript');
    expect(code).toHaveValue('moveDown();');
    fireEvent.click(screen.getByRole('button', { name: 'Start New Tank' }));
    expect(screen.getByLabelText('Language')).toHaveTextContent('JavaScript');
    await selectTankLanguage('typescript');
    expect(code.value).not.toContain('const health');
  });

  test('keeps Python drafts separate and updates the Monaco path and API reference', async () => {
    render(<TankEditor username="Pilot_One" />);
    const code = await screen.findByLabelText('Tank code');
    fireEvent.change(code, { target: { value: 'moveUp();' } });
    await selectTankLanguage('python');
    expect(code).toHaveAttribute('data-language', 'python');
    expect(code).toHaveAttribute('data-path', 'tank.py');
    expect(screen.getAllByText('move_up()', { selector: 'code' }).length).toBeGreaterThan(0);
    fireEvent.change(code, { target: { value: 'if tank_health > 0:\n    shoot()' } });
    await selectTankLanguage('javascript');
    expect(code).toHaveValue('moveUp();');
    await selectTankLanguage('python');
    expect(code).toHaveValue('if tank_health > 0:\n    shoot()');
    expect((await openLanguageMenu()).getByRole('option', { name: 'Java — coming soon' })).toHaveAttribute('aria-disabled', 'true');
  });

  test('saves original Python without launching its runtime just to save', async () => {
    const source = 'if tank_health > 0:\n    move_right()';
    createTank.mockResolvedValue({ ok: true, data: { id: 'python', name: 'Python', code: source, language: 'python', color: '#317d84' } });
    render(<TankEditor username="Pilot_One" />);
    fireEvent.change(screen.getByLabelText('Tank name'), { target: { value: 'Python' } });
    await selectTankLanguage('python');
    fireEvent.change(await screen.findByLabelText('Tank code'), { target: { value: source } });
    fireEvent.click(screen.getByRole('button', { name: 'Save New Tank' }));
    await waitFor(() => expect(createTank).toHaveBeenCalledWith({
      name: 'Python', code: source, language: 'python', color: '#317d84',
    }));
    expect(await screen.findByText(/Use Generate Command in the Debugger to check Python syntax/)).toBeInTheDocument();
    expect(screen.getByLabelText('Tank code')).toHaveValue(source);
  });

  test('loads and edits a saved Python tank without converting its source', async () => {
    const source = 'shoot()';
    getTanks.mockResolvedValue({ ok: true, data: [
      { id: 'python', name: 'Python', code: source, language: 'python', color: '#317d84' },
    ] });
    updateTank.mockResolvedValue({ ok: true, data: {
      id: 'python', name: 'Python', code: 'move_up()', language: 'python', color: '#317d84',
    } });
    render(<TankEditor username="Pilot_One" />);
    await waitFor(() => expect(screen.getByLabelText('Edit a saved tank').querySelector('option[value="python"]')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Edit a saved tank'), { target: { value: 'python' } });
    expect(screen.getByLabelText('Language')).toHaveTextContent('Python');
    fireEvent.change(await screen.findByLabelText('Tank code'), { target: { value: 'move_up()' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Tank' }));
    await waitFor(() => expect(updateTank).toHaveBeenCalledWith('python', {
      name: 'Python', code: 'move_up()', language: 'python', color: '#317d84',
    }));
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
