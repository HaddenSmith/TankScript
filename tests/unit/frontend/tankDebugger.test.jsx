/** @jest-environment jsdom */
import React from 'react';
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { TankEditor } from '../../../src/tank-editor/tank-editor.jsx';
import { getTanks } from '../../../src/services/api.js';

jest.mock('../../../src/tank-editor/editor/localMonacoEditor.js', () => ({
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

async function renderEditor() {
  const result = render(<TankEditor username="Pilot_One" />);
  await act(async () => {
    await Promise.resolve();
  });
  await screen.findByLabelText('Tank code');
  return result;
}

async function renderDebugger() {
  const result = await renderEditor();
  fireEvent.click(screen.getByRole('tab', { name: 'Debugger' }));
  return result;
}

function createDataTransfer() {
  const values = {};
  const dragImages = [];
  return {
    effectAllowed: '',
    dragImages,
    setData: (type, value) => { values[type] = value; },
    getData: (type) => values[type] ?? '',
    setDragImage: (element, x, y) => dragImages.push({ element, x, y }),
  };
}

function getOwnTankTarget() {
  return screen.getByRole('button', {
    name: /Your tank, Your Tank, x 1, y 1, rotation 0, health 3/,
  });
}

function getOwnTankVisual() {
  return screen.getByRole('button', { name: /Your tank, Your Tank/ }).previousElementSibling;
}

function mockArenaBounds() {
  const arena = screen.getByRole('group', { name: '8 by 8 debugger arena' });
  jest.spyOn(arena, 'getBoundingClientRect').mockReturnValue({
    left: 100, top: 200, right: 900, bottom: 1000, width: 800, height: 800,
  });
  return arena;
}

function clickArenaAt(x, y) {
  const cellX = Math.max(0, Math.min(7, Math.floor(x + 0.5)));
  const cellY = Math.max(0, Math.min(7, Math.floor(y + 0.5)));
  fireEvent.click(screen.getByRole('button', { name: `Grid square x ${cellX}, y ${cellY}` }), {
    clientX: 100 + (x + 0.5) * 100,
    clientY: 200 + (y + 0.5) * 100,
    detail: 1,
  });
}

function dragEventAt(type, target, dataTransfer, x, y) {
  // jsdom has no native DragEvent; supply the browser's pointer coordinates.
  const event = createEvent[type](target, { dataTransfer });
  Object.defineProperties(event, {
    clientX: { value: 100 + (x + 0.5) * 100 },
    clientY: { value: 200 + (y + 0.5) * 100 },
  });
  fireEvent(target, event);
}

describe('TankScript debugger', () => {
  beforeEach(() => {
    getTanks.mockResolvedValue({ ok: true, data: [] });
  });

  afterEach(() => jest.restoreAllMocks());

  test('switches between the API reference and debugger without losing unsaved editor code or scenario state', async () => {
    await renderEditor();

    expect(screen.getByRole('heading', { name: 'TankScript reference' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tank code'), {
      target: { value: 'const unsaved = true;' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Debugger' }));

    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grid square x 3, y 2' }));
    expect(screen.getByRole('button', { name: /Bullet 1, owner 0, x 3, y 2/ }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'API Reference' }));
    expect(screen.getByRole('heading', { name: 'TankScript reference' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Debugger' }));
    expect(screen.getByRole('button', { name: /Bullet 1, owner 0, x 3, y 2/ }))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Tank code')).toHaveValue('const unsaved = true;');
  });

  test('shows command output above the scenario arena and object palette', async () => {
    const { container } = await renderDebugger();
    const debuggerSection = container.querySelector('.tank-debugger');
    const commandPanel = debuggerSection.querySelector('.debugger-command-panel');
    const scenarioLayout = debuggerSection.querySelector('.tank-debugger-layout');

    expect([...debuggerSection.children].indexOf(commandPanel))
      .toBeLessThan([...debuggerSection.children].indexOf(scenarioLayout));
  });

  test('starts with the player tank and keeps its visual color synchronized with the editor', async () => {
    await renderDebugger();

    expect(screen.getByRole('group', { name: '8 by 8 debugger arena' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /tank, .*health 3/i })).toHaveLength(2);
    expect(screen.getByText('id', { selector: '.debugger-code-key' })).toBeInTheDocument();
    expect(getOwnTankVisual().style.getPropertyValue('--tank-color'))
      .toBe('#317d84');

    fireEvent.click(screen.getByRole('button', { name: 'Select red tank color' }));
    expect(getOwnTankVisual().style.getPropertyValue('--tank-color'))
      .toBe('#c94a4a');
  });

  test('uses stable sequential numeric tank IDs and direct 8-by-8 grid coordinates', async () => {
    await renderDebugger();
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('id: 0');

    fireEvent.click(screen.getByRole('button', { name: /Dummy tank, Dummy Tank, x 6, y 6/ }));
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('id: 1');
    fireEvent.click(screen.getByRole('button', { name: 'Dummy enemy tank' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grid square x 7, y 0' }));
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('id: 2');
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('x: 7');
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('y: 0');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dummy enemy tank' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grid square x 0, y 7' }));
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('id: 3');
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('x: 0');
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('y: 7');
  });

  test('adds and removes dummy tanks and bullets through the palette', async () => {
    await renderDebugger();

    fireEvent.click(screen.getByRole('button', { name: 'Dummy enemy tank' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grid square x 3, y 3' }));
    expect(screen.getByRole('button', {
      name: /Dummy tank, Dummy Tank, x 3, y 3, rotation 0, health 3/,
    })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('button', {
      name: /Dummy tank, Dummy Tank, x 3, y 3/,
    })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grid square x 4, y 2' }));
    expect(screen.getByRole('button', {
      name: 'Bullet 1, owner 0, x 4, y 2, rotation 0',
    })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('button', { name: /Bullet 1,/ })).not.toBeInTheDocument();
  });

  test('clears palette placement mode when clicking outside the arena', async () => {
    await renderDebugger();
    const enemyPaletteItem = screen.getByRole('button', { name: 'Dummy enemy tank' });
    fireEvent.click(enemyPaletteItem);
    expect(enemyPaletteItem).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('heading', { name: 'Inspector' }));

    expect(enemyPaletteItem).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Grid square x 3, y 3' }));
    expect(screen.queryByRole('button', { name: /Dummy tank, Dummy Tank, x 3, y 3/ }))
      .not.toBeInTheDocument();
  });

  test('accepts palette drag-and-drop and moves existing objects between grid cells', async () => {
    await renderDebugger();
    const dataTransfer = createDataTransfer();
    const enemyPaletteItem = screen.getByRole('button', { name: 'Dummy enemy tank' });
    const paletteTank = enemyPaletteItem.querySelector('.battle-tank');
    expect(paletteTank.style.width).toBe(paletteTank.style.height);
    jest.spyOn(paletteTank, 'getBoundingClientRect').mockReturnValue({
      width: 32,
      height: 32,
      left: 0,
      top: 0,
      right: 32,
      bottom: 32,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.dragStart(enemyPaletteItem, { dataTransfer });
    const paletteTankPreview = dataTransfer.dragImages[0].element.firstElementChild;
    expect(paletteTankPreview).not.toBe(paletteTank);
    expect(paletteTankPreview).toHaveClass('battle-tank');
    expect(dataTransfer.dragImages[0].element.style.left).toBe('-10000px');
    expect(paletteTankPreview.querySelector('.battle-tank__visual'))
      .toBeInTheDocument();
    expect(dataTransfer.dragImages[0]).toMatchObject({ x: 16, y: 16 });
    fireEvent.drop(screen.getByRole('button', { name: 'Grid square x 5, y 4' }), { dataTransfer });
    fireEvent.dragEnd(enemyPaletteItem);
    expect(dataTransfer.dragImages[0].element).not.toBeInTheDocument();
    const tank = screen.getByRole('button', {
      name: /Dummy tank, Dummy Tank, x 5, y 4/,
    });
    fireEvent.click(tank);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate Left' }));
    const rotatedTank = screen.getByRole('button', {
      name: /Dummy tank, Dummy Tank, x 5, y 4, rotation 90/,
    });

    const tankTransfer = createDataTransfer();
    fireEvent.dragStart(rotatedTank, { dataTransfer: tankTransfer });
    const rotatedTankPreview = tankTransfer.dragImages[0].element.firstElementChild;
    expect(rotatedTankPreview).toHaveClass('battle-tank');
    expect(rotatedTankPreview.style.transform).toContain('rotate(-90deg)');
    fireEvent.drop(screen.getByRole('button', { name: 'Grid square x 4, y 4' }), {
      dataTransfer: tankTransfer,
    });
    fireEvent.dragEnd(rotatedTank);
    expect(screen.getByRole('button', {
      name: /Dummy tank, Dummy Tank, x 4, y 4, rotation 90/,
    })).toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: /Dummy tank, Dummy Tank, x 5, y 4/,
    })).not.toBeInTheDocument();

    const bulletTransfer = createDataTransfer();
    const bulletPaletteItem = screen.getByRole('button', { name: 'Bullet' });
    fireEvent.dragStart(bulletPaletteItem, { dataTransfer: bulletTransfer });
    const paletteBulletPreview = bulletTransfer.dragImages[0].element.firstElementChild;
    expect(paletteBulletPreview).toHaveClass('battle-bullet');
    expect(paletteBulletPreview.querySelector('.debugger-bullet-direction__arrow'))
      .toBeInTheDocument();
    expect(paletteBulletPreview.querySelectorAll('.debugger-bullet-direction__arrow'))
      .toHaveLength(2);
    expect(paletteBulletPreview.style.transform).toContain('rotate(0deg)');
    const destination = screen.getByRole('button', { name: 'Grid square x 3, y 4' });
    fireEvent.dragOver(destination, { dataTransfer: bulletTransfer });
    expect(destination).toHaveClass('is-drop-target');
    fireEvent.drop(destination, { dataTransfer: bulletTransfer });
    fireEvent.dragEnd(bulletPaletteItem);
  });

  test('rejects placements outside the arena and prevents tanks from overlapping', async () => {
    await renderDebugger();
    const arena = screen.getByRole('group', { name: '8 by 8 debugger arena' });
    jest.spyOn(arena, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 800,
      width: 800,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const paletteTransfer = createDataTransfer();
    fireEvent.dragStart(screen.getByRole('button', { name: 'Dummy enemy tank' }), {
      dataTransfer: paletteTransfer,
    });
    fireEvent.drop(arena, { clientX: 810, clientY: 400, dataTransfer: paletteTransfer });
    expect(screen.getAllByRole('button', { name: /tank, .*health 3/i })).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Dummy enemy tank' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grid square x 6, y 6' }));
    expect(screen.getByText(
      'That square is outside the arena or already contains a tank.',
      { selector: '.debugger-placement-message' },
    )).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /tank, .*health 3/i })).toHaveLength(2);

    const dataTransfer = createDataTransfer();
    const enemy = screen.getByRole('button', { name: /Dummy tank, Dummy Tank, x 6, y 6/ });
    fireEvent.dragStart(enemy, { dataTransfer });
    fireEvent.drop(screen.getByRole('button', { name: 'Grid square x 1, y 1' }), { dataTransfer });
    expect(screen.getByRole('button', { name: /Dummy tank, Dummy Tank, x 6, y 6/ }))
      .toBeInTheDocument();
    expect(screen.getByText(
      'That square is outside the arena or already contains a tank.',
      { selector: '.debugger-placement-message' },
    )).toBeInTheDocument();
  });

  test('selects objects and shows their TankScript API data in the inspector', async () => {
    await renderDebugger();

    const inspector = screen.getByLabelText('Selected object data');
    expect(inspector).toHaveTextContent('id: 0');
    expect(inspector).toHaveTextContent('name: "Your Tank"');
    expect(inspector).toHaveTextContent('health: 3');

    fireEvent.click(screen.getByRole('button', { name: /Dummy tank, Dummy Tank, x 6, y 6/ }));
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('id: 1');
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('rotation: 180');

    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grid square x 2, y 5' }));
    fireEvent.click(screen.getByRole('button', { name: /Bullet 1,/ }));
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('ownerId: 0');
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('x: 2');
  });

  test('uses sequential numeric bullet IDs and keeps IDs stable when objects are removed', async () => {
    await renderDebugger();
    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grid square x 3, y 2' }));
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('id: 1');
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('ownerId: 0');

    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grid square x 4, y 2' }));
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('id: 2');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grid square x 5, y 2' }));
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('id: 3');
    expect(screen.getByRole('button', {
      name: 'Bullet 3, owner 0, x 5, y 2, rotation 0',
    })).toBeInTheDocument();
  });

  test('rotates tanks by engine increments and updates both visuals and inspector', async () => {
    await renderDebugger();

    fireEvent.click(getOwnTankTarget());
    fireEvent.click(screen.getByRole('button', { name: 'Rotate Left' }));
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('rotation: 90');
    expect(getOwnTankVisual().style.transform).toContain('rotate(-90deg)');

    fireEvent.click(screen.getByRole('button', { name: 'Rotate Right' }));
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('rotation: 0');
  });

  test('shows bullet direction and rotates bullets with engine direction values', async () => {
    await renderDebugger();
    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grid square x 3, y 2' }));

    const bulletTarget = screen.getByRole('button', {
      name: 'Bullet 1, owner 0, x 3, y 2, rotation 0',
    });
    const bulletVisual = document.querySelector('.battle-bullet.debugger-bullet-direction');
    expect(bulletVisual.querySelector('.debugger-bullet-direction__arrow')).toBeInTheDocument();
    expect(bulletVisual.style.transform).toContain('rotate(0deg)');

    fireEvent.click(screen.getByRole('button', { name: 'Rotate Left' }));
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('rotation: 90');
    expect(bulletVisual.style.transform).toContain('rotate(-90deg)');
    expect(bulletTarget.getAttribute('aria-label')).toMatch(/rotation 90/);
    const bulletTransfer = createDataTransfer();
    fireEvent.dragStart(bulletTarget, { dataTransfer: bulletTransfer });
    const rotatedBulletPreview = bulletTransfer.dragImages[0].element.firstElementChild;
    expect(rotatedBulletPreview).toHaveClass('battle-bullet');
    expect(rotatedBulletPreview.style.transform).toContain('rotate(-90deg)');
    expect(rotatedBulletPreview.querySelectorAll('.debugger-bullet-direction__arrow'))
      .toHaveLength(2);
    fireEvent.dragEnd(bulletTarget);

    fireEvent.click(screen.getByRole('button', { name: 'Rotate Right' }));
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('rotation: 0');
    fireEvent.keyDown(bulletTarget, { key: 'ArrowUp' });
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('y: 1.5');
    expect(screen.getByRole('button', {
      name: 'Bullet 1, owner 0, x 3, y 1.5, rotation 0',
    })).toBeInTheDocument();
  });

  test('moves selected objects with arrow keys and updates the inspector', async () => {
    await renderDebugger();
    const playerTank = getOwnTankTarget();

    expect(fireEvent.keyDown(playerTank, { key: 'ArrowRight' })).toBe(false);
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('x: 2');
    const movedTank = screen.getByRole('button', {
      name: /Your tank, Your Tank, x 2, y 1/,
    });
    expect(movedTank).toBeInTheDocument();
    expect(movedTank).toHaveClass('is-selected');
    fireEvent.keyDown(screen.getByRole('button', { name: /Your tank, Your Tank, x 2, y 1/ }), {
      key: 'ArrowUp',
    });
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('y: 0');
  });

  test('keeps keyboard movement within bounds and prevents tank overlap', async () => {
    await renderDebugger();
    const playerTank = getOwnTankTarget();
    fireEvent.keyDown(playerTank, { key: 'ArrowLeft' });
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('x: 0');
    fireEvent.keyDown(screen.getByRole('button', { name: /Your tank, Your Tank, x 0, y 1/ }), {
      key: 'ArrowLeft',
    });
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('x: 0');

    const player = screen.getByRole('button', { name: /Your tank, Your Tank, x 0, y 1/ });
    for (let step = 0; step < 5; step += 1) {
      fireEvent.keyDown(player, { key: 'ArrowRight' });
    }
    for (let step = 0; step < 5; step += 1) {
      fireEvent.keyDown(player, { key: 'ArrowDown' });
    }
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('x: 5');
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('y: 6');

    fireEvent.keyDown(player, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: /Your tank, Your Tank, x 5, y 6/ }))
      .toBeInTheDocument();
    expect(screen.getByText(
      'That square is outside the arena or already contains a tank.',
      { selector: '.debugger-placement-message' },
    )).toBeInTheDocument();
  });

  test('deletes selected dummy tanks and bullets with Delete and Backspace, but protects the player', async () => {
    await renderDebugger();
    const playerTank = getOwnTankTarget();
    expect(fireEvent.keyDown(playerTank, { key: 'Backspace' })).toBe(false);
    expect(screen.getByRole('button', { name: /Your tank, Your Tank, x 1, y 1/ }))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('id: 0');

    const enemy = screen.getByRole('button', { name: /Dummy tank, Dummy Tank, x 6, y 6/ });
    fireEvent.click(enemy);
    fireEvent.keyDown(enemy, { key: 'Delete' });
    expect(screen.queryByRole('button', { name: /Dummy tank, Dummy Tank, x 6, y 6/ }))
      .not.toBeInTheDocument();
    expect(screen.queryByLabelText('Selected object data')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grid square x 4, y 3' }));
    fireEvent.keyDown(screen.getByRole('button', { name: /Bullet 1,/ }), {
      key: 'Backspace',
    });
    expect(screen.queryByRole('button', { name: /Bullet 1,/ })).not.toBeInTheDocument();
  });

  test('does not apply debugger shortcuts while typing in editor fields or using other tabs', async () => {
    await renderDebugger();
    fireEvent.keyDown(screen.getByLabelText('Tank code'), { key: 'ArrowRight' });
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('x: 1');
    fireEvent.change(screen.getByLabelText('Tank name'), { target: { value: 'Typed name' } });
    fireEvent.keyDown(screen.getByLabelText('Tank name'), { key: 'ArrowDown' });
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('y: 1');

    fireEvent.click(screen.getByRole('tab', { name: 'API Reference' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'API Reference' }), { key: 'ArrowRight' });
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('x: 1');
  });

  test('resets the scenario but preserves current tank color and editor code', async () => {
    await renderDebugger();
    fireEvent.change(screen.getByLabelText('Tank code'), {
      target: { value: 'const keepMe = true;' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Select blue tank color' }));
    fireEvent.click(getOwnTankTarget());
    fireEvent.click(screen.getByRole('button', { name: 'Rotate Left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grid square x 2, y 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dummy enemy tank' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grid square x 3, y 5' }));

    fireEvent.click(screen.getByRole('button', { name: 'Reset Scenario' }));

    expect(screen.getAllByRole('button', { name: /tank, .*health 3/i })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Bullet \d+,/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('x: 1');
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('rotation: 0');
    expect(getOwnTankVisual().style.getPropertyValue('--tank-color'))
      .toBe('#23496b');
    expect(screen.getByLabelText('Tank code')).toHaveValue('const keepMe = true;');
    expect(screen.getByText('No command generated yet.')).toBeInTheDocument();
  });

  test('generates commands with the current code and marks the result stale after an arena edit', async () => {
    await renderDebugger();
    const playerCode = 'moveRight();';
    fireEvent.change(screen.getByLabelText('Tank code'), { target: { value: playerCode } });

    fireEvent.click(screen.getByRole('button', { name: 'Generate Command' }));

    expect(screen.getByLabelText('Tank code')).toHaveValue(playerCode);
    expect(screen.getByText(/"action": "moveRight"/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rotate Left' }));
    expect(screen.getByText('Scenario changed. Generate a new command.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Generate Command' }));
    expect(screen.getByText(/"action": "moveRight"/)).toBeInTheDocument();
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('x: 1');
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('y: 1');
  });

  test('reports errors when current tank code cannot generate a command', async () => {
    await renderDebugger();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    fireEvent.change(screen.getByLabelText('Tank code'), { target: { value: 'moveUp(' } });

    fireEvent.click(screen.getByRole('button', { name: 'Generate Command' }));

    expect(screen.getByText(/Error: Unexpected token/)).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      'Could not generate TankScript command:',
      expect.any(SyntaxError),
    );
  });

  test.each([[2.5, 3], [4, 5.5], [-0.5, 0], [7.5, 7]])(
    'places a bullet at (%s, %s) without losing fractional coordinates', async (x, y) => {
      await renderDebugger();
      mockArenaBounds();
      fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
      clickArenaAt(x, y);

      const target = screen.getByRole('button', { name: `Bullet 1, owner 0, x ${x}, y ${y}, rotation 0` });
      expect(screen.getByLabelText('Selected object data')).toHaveTextContent(`x: ${x}`);
      expect(screen.getByLabelText('Selected object data')).toHaveTextContent(`y: ${y}`);
      expect(target.style.left).toBe(`${((x + 0.5) / 8) * 100}%`);
      expect(target.style.top).toBe(`${((y + 0.5) / 8) * 100}%`);
      expect(target.previousElementSibling.style.left).toBe(target.style.left);
      expect(target.previousElementSibling.style.top).toBe(target.style.top);
    },
  );

  test('drags palette bullets and rotated midpoint bullets using the same snapping and preview position', async () => {
    await renderDebugger();
    const arena = mockArenaBounds();
    const palette = screen.getByRole('button', { name: 'Bullet' });
    const transfer = createDataTransfer();
    fireEvent.dragStart(palette, { dataTransfer: transfer });
    // During dragover the browser may not expose the transfer data.
    dragEventAt('dragOver', arena, { getData: () => '' }, 2.5, 3);
    const marker = document.querySelector('.debugger-bullet-drop-target');
    expect(marker.style.left).toBe('37.5%');
    expect(marker.style.top).toBe('43.75%');
    dragEventAt('drop', screen.getByRole('button', { name: 'Grid square x 3, y 3' }), transfer, 2.5, 3);
    fireEvent.dragEnd(palette);
    expect(screen.getByRole('button', { name: 'Bullet 1, owner 0, x 2.5, y 3, rotation 0' }))
      .toBeInTheDocument();
    expect(marker).not.toBeInTheDocument();
    expect(transfer.dragImages[0].element).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rotate Left' }));
    const bullet = screen.getByRole('button', { name: 'Bullet 1, owner 0, x 2.5, y 3, rotation 90' });
    const movedTransfer = createDataTransfer();
    fireEvent.dragStart(bullet, { dataTransfer: movedTransfer });
    const preview = movedTransfer.dragImages[0].element.firstElementChild;
    expect(preview.style.transform).toContain('rotate(-90deg)');
    expect(preview.style.left).toBe('50%');
    expect(preview.style.top).toBe('50%');
    expect(preview.querySelectorAll('.debugger-bullet-direction__arrow')).toHaveLength(2);
    dragEventAt('drop', arena, movedTransfer, 4, 5.5);
    fireEvent.dragEnd(bullet);
    expect(screen.getByRole('button', { name: 'Bullet 1, owner 0, x 4, y 5.5, rotation 90' }))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('y: 5.5');
    expect(preview).not.toBeInTheDocument();
  });

  test('rotates midpoint bullets through all directions without changing either coordinate', async () => {
    await renderDebugger();
    mockArenaBounds();
    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    clickArenaAt(2.5, 3);
    for (const rotation of [90, 180, 270, 0]) {
      fireEvent.click(screen.getByRole('button', { name: 'Rotate Left' }));
      const target = screen.getByRole('button', { name: `Bullet 1, owner 0, x 2.5, y 3, rotation ${rotation}` });
      expect(target.previousElementSibling.style.transform).toContain(`rotate(${-rotation}deg)`);
      expect(screen.getByLabelText('Selected object data')).toHaveTextContent('x: 2.5');
      expect(screen.getByLabelText('Selected object data')).toHaveTextContent('y: 3');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Rotate Right' }));
    expect(screen.getByRole('button', { name: 'Bullet 1, owner 0, x 2.5, y 3, rotation 270' }))
      .toBeInTheDocument();
  });

  test('moves bullets to the next valid position with every arrow key and keeps tanks on whole cells', async () => {
    await renderDebugger();
    const arena = mockArenaBounds();
    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    clickArenaAt(2.5, 3);
    for (const [key, x, y] of [
      ['ArrowUp', 2.5, 2], ['ArrowRight', 3, 2], ['ArrowDown', 3, 2.5], ['ArrowLeft', 2, 2.5],
    ]) {
      fireEvent.keyDown(arena, { key });
      expect(screen.getByRole('button', { name: `Bullet 1, owner 0, x ${x}, y ${y}, rotation 0` }))
        .toBeInTheDocument();
    }
    fireEvent.click(getOwnTankTarget());
    fireEvent.keyDown(arena, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: /Your tank, Your Tank, x 2, y 1/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dummy enemy tank' }));
    clickArenaAt(4.4, 4.4);
    expect(screen.getByRole('button', { name: /Dummy tank, Dummy Tank, x 4, y 4/ })).toBeInTheDocument();
  });

  test.each([
    [-0.5, 3, 'ArrowLeft', -0.6, 3], [7.5, 3, 'ArrowRight', 7.6, 3],
    [3, -0.5, 'ArrowUp', 3, -0.6], [3, 7.5, 'ArrowDown', 3, 7.6],
  ])('rejects keyboard and pointer movement beyond bullet boundary (%s, %s)', async (x, y, key, outsideX, outsideY) => {
    await renderDebugger();
    const arena = mockArenaBounds();
    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    clickArenaAt(x, y);
    const label = `Bullet 1, owner 0, x ${x}, y ${y}, rotation 0`;
    fireEvent.keyDown(arena, { key });
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    const transfer = createDataTransfer();
    fireEvent.dragStart(screen.getByRole('button', { name: label }), { dataTransfer: transfer });
    dragEventAt('dragOver', arena, transfer, outsideX, outsideY);
    expect(document.querySelector('.debugger-bullet-drop-target')).not.toBeInTheDocument();
    dragEventAt('drop', arena, transfer, outsideX, outsideY);
    fireEvent.dragEnd(arena);
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    clickArenaAt(outsideX, outsideY);
    expect(screen.getAllByRole('button', { name: /Bullet \d+,/ })).toHaveLength(1);
  });

  test.each(['Delete', 'Backspace'])('selects a midpoint bullet and removes it with %s', async key => {
    await renderDebugger();
    const arena = mockArenaBounds();
    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    clickArenaAt(2.5, 3);
    fireEvent.click(getOwnTankTarget());
    const bullet = screen.getByRole('button', { name: /Bullet 1, owner 0, x 2.5, y 3/ });
    fireEvent.click(bullet);
    expect(bullet).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Selected object data')).toHaveTextContent('x: 2.5');
    fireEvent.keyDown(arena, { key });
    expect(screen.queryByRole('button', { name: /Bullet 1,/ })).not.toBeInTheDocument();
  });

  test('Generate Command receives exact fractional coordinates and reset clears midpoint objects and previews', async () => {
    await renderDebugger();
    const arena = mockArenaBounds();
    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    clickArenaAt(-0.5, 3);
    fireEvent.change(screen.getByLabelText('Tank code'), { target: {
      value: 'if (allBullets[0].x === -0.5 && allBullets[0].y === 3) shoot();',
    } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Command' }));
    expect(screen.getByText(/"action": "shoot"/)).toBeInTheDocument();
    const transfer = createDataTransfer();
    fireEvent.dragStart(screen.getByRole('button', { name: /Bullet 1,/ }), { dataTransfer: transfer });
    dragEventAt('dragOver', arena, transfer, 2.5, 3);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Scenario' }));
    expect(document.querySelector('.debugger-drag-image')).not.toBeInTheDocument();
    expect(document.querySelector('.debugger-bullet-drop-target')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bullet \d+,/ })).not.toBeInTheDocument();
    expect(getOwnTankTarget()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dummy tank, Dummy Tank, x 6, y 6/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    clickArenaAt(2.5, 3);
    expect(screen.getByRole('button', { name: /Bullet 1, owner 0, x 2.5, y 3/ })).toBeInTheDocument();
  });

  test('removes the custom drag image when the debugger unmounts', async () => {
    const { unmount } = await renderDebugger();
    fireEvent.dragStart(screen.getByRole('button', { name: 'Bullet' }), { dataTransfer: createDataTransfer() });
    const preview = document.querySelector('.debugger-drag-image');
    expect(preview).toBeInTheDocument();
    unmount();
    expect(preview).not.toBeInTheDocument();
  });

  test.each([
    [2.5, 3.5, 2.5, 4], [2.35, 3.55, 2, 3.5], [2.55, 3.35, 2.5, 3],
    [-0.5, -0.5, -0.5, 0], [7.5, 7.5, 7.5, 7],
  ])('clicking or dragging near (%s, %s) snaps to a midpoint on one axis only', async (pointerX, pointerY, x, y) => {
    await renderDebugger();
    const arena = mockArenaBounds();
    fireEvent.click(screen.getByRole('button', { name: 'Bullet' }));
    clickArenaAt(pointerX, pointerY);
    const bullet = screen.getByRole('button', { name: `Bullet 1, owner 0, x ${x}, y ${y}, rotation 0` });
    const transfer = createDataTransfer();
    fireEvent.dragStart(bullet, { dataTransfer: transfer });
    dragEventAt('dragOver', arena, transfer, pointerX, pointerY);
    const marker = document.querySelector('.debugger-bullet-drop-target');
    expect(marker.style.left).toBe(`${((x + 0.5) / 8) * 100}%`);
    expect(marker.style.top).toBe(`${((y + 0.5) / 8) * 100}%`);
    dragEventAt('drop', arena, transfer, pointerX, pointerY);
    fireEvent.dragEnd(bullet);
    expect(screen.getByRole('button', { name: `Bullet 1, owner 0, x ${x}, y ${y}, rotation 0` }))
      .toBeInTheDocument();
  });

  test('Enter in the arena or on an object generates the current command without advancing the scenario', async () => {
    await renderDebugger();
    const arena = screen.getByRole('group', { name: '8 by 8 debugger arena' });
    fireEvent.change(screen.getByLabelText('Tank code'), { target: { value: 'moveRight();' } });
    expect(fireEvent.keyDown(arena, { key: 'Enter' })).toBe(false);
    expect(screen.getByText(/"action": "moveRight"/)).toBeInTheDocument();
    expect(getOwnTankTarget()).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tank code'), { target: { value: 'shoot();' } });
    fireEvent.keyDown(getOwnTankTarget(), { key: 'Enter' });
    expect(screen.getByText(/"action": "shoot"/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tank code'), { target: { value: 'rotateLeft();' } });
    fireEvent.keyDown(arena, { key: 'Enter', repeat: true });
    expect(screen.getByText(/"action": "shoot"/)).toBeInTheDocument();
  });

  test('Enter while editing or using the other tab does not generate a debugger command', async () => {
    await renderDebugger();
    fireEvent.keyDown(screen.getByLabelText('Tank code'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByLabelText('Tank name'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('tab', { name: 'API Reference' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'API Reference' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('tab', { name: 'Debugger' }));
    expect(screen.getByText('No command generated yet.')).toBeInTheDocument();
  });
});
