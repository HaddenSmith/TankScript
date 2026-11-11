import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BattleTank } from '../../battle/components/BattleTank';
import { BattleBullet } from '../../battle/components/BattleBullet';
import { TankScriptRunnerError } from '../../../../shared/game/tank-script/tankScriptRunnerProtocol.js';
import { DEFAULT_TANK_COLOR } from '../../../../shared/game/tankColors.js';
import {
  canPlaceDebuggerBullet,
  canPlaceDebuggerTank,
  createDefaultDebuggerScenario,
  createDebuggerTankState,
  DEBUGGER_ARENA_HEIGHT,
  DEBUGGER_ARENA_WIDTH,
  PLAYER_TANK_ID,
} from './scenario';

const ENEMY_TANK_COLOR = '#c94a4a';
const DRAG_DATA_TYPE = 'application/x-tankscript-object';
const SCENARIO_CHANGED_MESSAGE = 'Scenario changed. Generate a new command.';
const CODE_CHANGED_MESSAGE = 'Tank code changed. Generate a new command.';
const GENERATING_MESSAGE = 'Generating command…';

export const TankScriptDebugger = memo(function TankScriptDebugger({
  tankColor = DEFAULT_TANK_COLOR,
  tankName = '',
  tankCodeRef,
  codeChangedRef,
  isActive,
}) {
  const [scenario, setScenario] = useState(() => createDefaultDebuggerScenario(tankName));
  const [selectedObject, setSelectedObject] = useState({ type: 'tank', id: PLAYER_TANK_ID });
  const [placementType, setPlacementType] = useState(null);
  const [placementMessage, setPlacementMessage] = useState('');
  const [commandOutput, setCommandOutput] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const nextEnemyId = useRef(2);
  const nextBulletId = useRef(1);
  const draggedObject = useRef(null);
  const dragImage = useRef(null);
  const arenaRef = useRef(null);
  const activeRequest = useRef(null);
  const isGenerating = commandOutput === GENERATING_MESSAGE;

  const cancelCommand = useCallback(() => {
    const request = activeRequest.current;
    if (!request) return false;

    activeRequest.current = null;
    request.abort();
    return true;
  }, []);

  const markScenarioChanged = useCallback(() => {
    cancelCommand();
    setCommandOutput((currentOutput) => (
      currentOutput === null ? null : SCENARIO_CHANGED_MESSAGE
    ));
  }, [cancelCommand]);

  useLayoutEffect(() => {
    markScenarioChanged();
    setScenario((currentScenario) => ({
      ...currentScenario,
      allTanks: currentScenario.allTanks.map((tank) => (
        tank.id === PLAYER_TANK_ID
          ? { ...tank, name: tankName.trim() || 'Your Tank' }
          : tank
      )),
    }));
  }, [tankName, markScenarioChanged]);

  useLayoutEffect(() => {
    codeChangedRef.current = () => {
      cancelCommand();
      setCommandOutput((currentOutput) => (
        currentOutput === null ? null : CODE_CHANGED_MESSAGE
      ));
    };
    return () => {
      codeChangedRef.current = null;
      cancelCommand();
    };
  }, [codeChangedRef, cancelCommand]);

  useLayoutEffect(() => {
    if (!isActive && cancelCommand()) setCommandOutput(null);
  }, [isActive, cancelCommand]);

  useEffect(() => () => {
    dragImage.current?.remove();
    dragImage.current = null;
    draggedObject.current = null;
  }, []);

  const selectedTank = selectedObject?.type === 'tank'
    ? scenario.allTanks.find((tank) => tank.id === selectedObject.id)
    : null;
  const selectedBullet = selectedObject?.type === 'bullet'
    ? scenario.allBullets.find((bullet) => bullet.id === selectedObject.id)
    : null;
  const selectedData = selectedTank ?? selectedBullet;
  const selectedIsPlayer = selectedTank?.id === PLAYER_TANK_ID;

  async function handleGenerateCommand() {
    if (!isActive || activeRequest.current) return;

    const request = new AbortController();
    activeRequest.current = request;
    setCommandOutput(GENERATING_MESSAGE);

    let runner;
    let output;
    try {
      const code = tankCodeRef.current;
      const state = createDebuggerTankState(scenario);
      const { createTankScriptWorkerRunner } = await import('../../game/tank-script/tankScriptWorkerRunner');
      if (activeRequest.current !== request) return;

      runner = await createTankScriptWorkerRunner(code, { signal: request.signal });
      if (activeRequest.current !== request) return;

      const command = await runner.runTick(state);
      output = command ? JSON.stringify(command, null, 2) : 'No action was submitted.';
    } catch (error) {
      if (activeRequest.current !== request) return;
      console.error('Could not generate TankScript command:', error);
      let message = 'Could not generate a command. Try again.';
      if (error instanceof TankScriptRunnerError) {
        message = error.message;
        if (error.code === 'COMPILE_ERROR') message += ' Check your JavaScript syntax.';
        if (error.code === 'RUNTIME_ERROR') message = 'TankScript threw an error or exceeded its memory or stack limit.';
      }
      output = `Error: ${message}`;
    } finally {
      await runner?.dispose().catch((error) => {
        console.error('Could not clean up the TankScript command runner:', error);
      });
      if (activeRequest.current === request) {
        activeRequest.current = null;
        setCommandOutput(output);
      }
    }
  }

  function createTankAt(x, y) {
    if (!canPlaceDebuggerTank(scenario, x, y)) {
      setPlacementMessage('That square is outside the arena or already contains a tank.');
      return;
    }

    const id = nextEnemyId.current++;
    const tank = {
      id,
      name: 'Dummy Tank',
      x,
      y,
      rotation: 0,
      health: 3,
    };
    markScenarioChanged();
    setScenario((currentScenario) => ({
      ...currentScenario,
      allTanks: [...currentScenario.allTanks, tank],
    }));
    setSelectedObject({ type: 'tank', id });
    setPlacementType(null);
    setPlacementMessage('');
  }

  function createBulletAt(x, y) {
    if (!canPlaceDebuggerBullet(scenario, x, y)) {
      setPlacementMessage('Choose a bullet position inside the arena.');
      return;
    }

    const id = nextBulletId.current++;
    const bullet = { id, ownerId: scenario.tankId, x, y, rotation: 0 };
    markScenarioChanged();
    setScenario((currentScenario) => ({
      ...currentScenario,
      allBullets: [...currentScenario.allBullets, bullet],
    }));
    setSelectedObject({ type: 'bullet', id });
    setPlacementType(null);
    setPlacementMessage('');
  }

  function placeObjectAt(type, x, y) {
    if (type === 'tank') {
      createTankAt(x, y);
    } else if (type === 'bullet') {
      createBulletAt(x, y);
    }
  }

  function moveTank(tankId, x, y) {
    if (!canPlaceDebuggerTank(scenario, x, y, tankId)) {
      setPlacementMessage('That square is outside the arena or already contains a tank.');
      return;
    }

    markScenarioChanged();
    setScenario((currentScenario) => ({
      ...currentScenario,
      allTanks: currentScenario.allTanks.map((tank) => (
        tank.id === tankId ? { ...tank, x, y } : tank
      )),
    }));
    setSelectedObject({ type: 'tank', id: tankId });
    setPlacementMessage('');
  }

  function moveBullet(bulletId, x, y) {
    if (!canPlaceDebuggerBullet(scenario, x, y)) {
      setPlacementMessage('Choose a bullet position inside the arena.');
      return;
    }

    markScenarioChanged();
    setScenario((currentScenario) => ({
      ...currentScenario,
      allBullets: currentScenario.allBullets.map((bullet) => (
        bullet.id === bulletId ? { ...bullet, x, y } : bullet
      )),
    }));
    setSelectedObject({ type: 'bullet', id: bulletId });
    setPlacementMessage('');
  }

  function handleSquareClick(event) {
    if (placementType) {
      const position = getArenaPosition(event, placementType);
      if (position) placeObjectAt(placementType, position.x, position.y);
      return;
    }
    setSelectedObject(null);
  }

  function handleDebuggerClick(event) {
    if (placementType &&
      !event.target.closest('.debugger-arena') &&
      !event.target.closest('.debugger-palette-item')) {
      setPlacementType(null);
    }
  }

  function getDragImageSource(event, type) {
    if (event.currentTarget.matches('.debugger-palette-item')) {
      return event.currentTarget.querySelector(type === 'tank' ? '.battle-tank' : '.battle-bullet');
    }
    return event.currentTarget.previousElementSibling;
  }

  function getDragImageRotation(object) {
    if (object.type === 'palette') return 0;
    const objects = object.type === 'tank' ? scenario.allTanks : scenario.allBullets;
    return objects.find((item) => item.id === object.id)?.rotation ?? 0;
  }

  function createDragImage(source, object) {
    const objectType = object.type === 'palette' ? object.objectType : object.type;
    const rotation = getDragImageRotation(object);
    const sourceBounds = source.getBoundingClientRect();
    let width = source.offsetWidth || sourceBounds.width;
    let height = source.offsetHeight || sourceBounds.height;

    if (object.type === 'palette') {
      const arenaBounds = arenaRef.current?.getBoundingClientRect();
      const paletteBounds = source.parentElement.getBoundingClientRect();
      if (arenaBounds?.width && arenaBounds.height && paletteBounds.width && paletteBounds.height) {
        width *= (arenaBounds.width / DEBUGGER_ARENA_WIDTH) / paletteBounds.width;
        height *= (arenaBounds.height / DEBUGGER_ARENA_HEIGHT) / paletteBounds.height;
      }
    }

    if (!width || !height) {
      const arenaBounds = arenaRef.current?.getBoundingClientRect();
      const cellWidth = arenaBounds?.width
        ? arenaBounds.width / DEBUGGER_ARENA_WIDTH
        : 40;
      const cellHeight = arenaBounds?.height
        ? arenaBounds.height / DEBUGGER_ARENA_HEIGHT
        : 40;
      width = cellWidth * (objectType === 'tank' ? 0.72 : 0.44);
      height = cellHeight * (objectType === 'tank' ? 0.72 : 0.18);
    }

    const preview = source.cloneNode(true);
    preview.style.position = 'absolute';
    preview.style.left = '50%';
    preview.style.top = '50%';
    preview.style.width = `${width}px`;
    preview.style.height = `${height}px`;
    preview.style.transform = `translate(-50%, -50%) rotate(${-rotation}deg)`;
    preview.style.transformOrigin = 'center';

    const isBullet = objectType === 'bullet';
    const isVerticalBullet = isBullet && rotation % 180 !== 0;
    const previewWidth = isVerticalBullet ? height * 3 : width;
    const previewHeight = isVerticalBullet ? width : (isBullet ? height * 3 : height);
    const previewContainer = document.createElement('div');
    previewContainer.className = 'debugger-drag-image';
    Object.assign(previewContainer.style, {
      position: 'fixed',
      left: '-10000px',
      top: '-10000px',
      display: 'grid',
      placeItems: 'center',
      width: `${previewWidth}px`,
      height: `${previewHeight}px`,
      pointerEvents: 'none',
      zIndex: '9999',
    });
    previewContainer.appendChild(preview);
    document.body.appendChild(previewContainer);
    dragImage.current = previewContainer;
    return { element: previewContainer, width: previewWidth, height: previewHeight };
  }

  function handleObjectDragEnd() {
    dragImage.current?.remove();
    dragImage.current = null;
    draggedObject.current = null;
    setDropTarget(null);
  }

  function handleObjectDragStart(event, object) {
    handleObjectDragEnd();
    draggedObject.current = object;
    if (event.dataTransfer) {
      event.dataTransfer.setData(DRAG_DATA_TYPE, JSON.stringify(object));
      event.dataTransfer.effectAllowed = 'move';
      const source = getDragImageSource(
        event,
        object.type === 'palette' ? object.objectType : object.type,
      );
      if (source && typeof event.dataTransfer.setDragImage === 'function') {
        const preview = createDragImage(source, object);
        if (preview) {
          event.dataTransfer.setDragImage(
            preview.element,
            preview.width / 2,
            preview.height / 2,
          );
        }
      }
    }
  }

  function readDraggedObject(event) {
    if (event.dataTransfer) {
      const payload = event.dataTransfer.getData(DRAG_DATA_TYPE);
      if (payload) {
        try {
          return JSON.parse(payload);
        } catch (error) {
          console.error('Could not read the dragged debugger object:', error);
          return null;
        }
      }
    }
    return draggedObject.current;
  }

  function getArenaPosition(event, objectType) {
    const targetCell = event.target.closest?.('[data-grid-x][data-grid-y]');
    const bounds = arenaRef.current.getBoundingClientRect();

    // Keyboard activation has no pointer position; keep the focused cell's center.
    if ((event.type === 'click' && event.detail === 0) || !bounds.width || !bounds.height) {
      if (!targetCell) return null;
      return { x: Number(targetCell.dataset.gridX), y: Number(targetCell.dataset.gridY) };
    }

    if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) return null;

    // Rendering puts coordinate (0, 0) at the center of the first grid cell.
    const gridX = ((event.clientX - bounds.left) / bounds.width) * DEBUGGER_ARENA_WIDTH;
    const gridY = ((event.clientY - bounds.top) / bounds.height) * DEBUGGER_ARENA_HEIGHT;
    if (objectType === 'bullet') {
      const pointerX = gridX - 0.5;
      const pointerY = gridY - 0.5;
      let x = Math.round(pointerX * 2) / 2;
      let y = Math.round(pointerY * 2) / 2;

      // Snap intersections to the nearest edge midpoint, keeping one axis whole.
      if (!Number.isInteger(x) && !Number.isInteger(y)) {
        const wholeX = Math.max(0, Math.min(DEBUGGER_ARENA_WIDTH - 1, Math.round(pointerX)));
        const wholeY = Math.max(0, Math.min(DEBUGGER_ARENA_HEIGHT - 1, Math.round(pointerY)));
        if (Math.abs(pointerX - wholeX) < Math.abs(pointerY - wholeY)) x = wholeX;
        else y = wholeY;
      }
      return { x, y };
    }
    return { x: Math.floor(gridX), y: Math.floor(gridY) };
  }

  function handleArenaDrop(event) {
    event.preventDefault();
    setDropTarget(null);
    const object = readDraggedObject(event);
    const objectType = object?.type === 'palette' ? object.objectType : object?.type;
    const position = getArenaPosition(event, objectType);
    draggedObject.current = null;
    if (!object || !position) {
      setPlacementMessage('Drop the object onto a square inside the arena.');
      return;
    }

    if (object.type === 'palette') {
      placeObjectAt(object.objectType, position.x, position.y);
    } else if (object.type === 'tank') {
      moveTank(object.id, position.x, position.y);
    } else if (object.type === 'bullet') {
      moveBullet(object.id, position.x, position.y);
    }
  }

  function handleArenaDragOver(event) {
    event.preventDefault();
    // Browsers can hide drag data during dragover; use our active drag reference.
    const object = draggedObject.current;
    const objectType = object?.type === 'palette' ? object.objectType : object?.type;
    const position = getArenaPosition(event, objectType);
    let nextTarget = null;
    if (objectType === 'bullet' && position && canPlaceDebuggerBullet(scenario, position.x, position.y)) {
      nextTarget = position;
    } else if (objectType === 'tank' && position &&
      canPlaceDebuggerTank(scenario, position.x, position.y, object.id)) {
      nextTarget = position;
    }
    setDropTarget((currentTarget) => (
      currentTarget?.x === nextTarget?.x && currentTarget?.y === nextTarget?.y
        ? currentTarget
        : nextTarget
    ));
  }

  function handleArenaDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null);
  }

  function rotateSelectedObject(direction) {
    if (!selectedData) return;
    const rotationOffset = direction === 'left' ? 90 : 270;
    markScenarioChanged();
    setScenario((currentScenario) => ({
      ...currentScenario,
      allTanks: selectedObject.type === 'tank'
        ? currentScenario.allTanks.map((tank) => (
          tank.id === selectedObject.id
            ? { ...tank, rotation: (tank.rotation + rotationOffset) % 360 }
            : tank
        ))
        : currentScenario.allTanks,
      allBullets: selectedObject.type === 'bullet'
        ? currentScenario.allBullets.map((bullet) => (
          bullet.id === selectedObject.id
            ? { ...bullet, rotation: (bullet.rotation + rotationOffset) % 360 }
            : bullet
        ))
        : currentScenario.allBullets,
    }));
    arenaRef.current?.focus();
  }

  function removeSelectedObject() {
    if (selectedTank && !selectedIsPlayer) {
      markScenarioChanged();
      setScenario((currentScenario) => ({
        ...currentScenario,
        allTanks: currentScenario.allTanks.filter((tank) => tank.id !== selectedTank.id),
      }));
      setSelectedObject(null);
      arenaRef.current?.focus();
    } else if (selectedBullet) {
      markScenarioChanged();
      setScenario((currentScenario) => ({
        ...currentScenario,
        allBullets: currentScenario.allBullets.filter((bullet) => bullet.id !== selectedBullet.id),
      }));
      setSelectedObject(null);
      arenaRef.current?.focus();
    }
  }

  function handleArenaKeyDown(event) {
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      if (!event.repeat && !event.nativeEvent.isComposing) handleGenerateCommand();
      return;
    }

    const directions = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const direction = directions[event.key];
    if (direction && selectedData) {
      event.preventDefault();
      const step = selectedBullet ? 0.5 : 1;
      let x = selectedData.x + direction[0] * step;
      let y = selectedData.y + direction[1] * step;
      if (selectedBullet && !Number.isInteger(x) && !Number.isInteger(y)) {
        x += direction[0] * step;
        y += direction[1] * step;
      }
      if (selectedTank) moveTank(selectedTank.id, x, y);
      else moveBullet(selectedBullet.id, x, y);
      return;
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedData) {
      event.preventDefault();
      if (!selectedIsPlayer) removeSelectedObject();
    }
  }

  function resetScenario() {
    setScenario(createDefaultDebuggerScenario(tankName));
    setSelectedObject({ type: 'tank', id: PLAYER_TANK_ID });
    setPlacementType(null);
    setPlacementMessage('');
    markScenarioChanged();
    nextEnemyId.current = 2;
    nextBulletId.current = 1;
    handleObjectDragEnd();
  }

  return (
    <section
      className="tank-debugger"
      aria-labelledby="tank-debugger-heading"
      onClick={handleDebuggerClick}
    >
      <header className="tank-debugger-header">
        <div>
          <p className="tank-reference-label">SCENARIO BUILDER</p>
          <h2 id="tank-debugger-heading">TankScript debugger</h2>
          <p>Arrange tanks and bullets to inspect the state your script will receive.</p>
        </div>
        <button className="btn btn-secondary" type="button" onClick={resetScenario}>
          Reset Scenario
        </button>
      </header>

      <section className="debugger-command-panel" aria-labelledby="debugger-command-heading">
        <div>
          <p className="tank-reference-label">ONE-TICK PREVIEW</p>
          <h3 id="debugger-command-heading">Command output</h3>
          <p>Evaluate your tank code once against the current scenario. This does not advance the battle.</p>
        </div>
        <button
          className="btn btn-primary debugger-generate-button"
          type="button"
          onClick={handleGenerateCommand}
          disabled={isGenerating}
        >
          {isGenerating ? 'Generating…' : 'Generate Command'}
        </button>
        <output className="debugger-command-output" aria-live="polite">
          {commandOutput ?? 'No command generated yet.'}
        </output>
      </section>

      <div className="tank-debugger-layout">
        <section className="debugger-arena-panel" aria-labelledby="debugger-arena-heading">
          <div className="debugger-section-heading">
            <div>
              <p className="tank-reference-label">8 × 8 GRID</p>
              <h3 id="debugger-arena-heading">Scenario arena</h3>
            </div>
            <span className="debugger-arena-size">8 × 8</span>
          </div>
          <div
            className="battle-arena debugger-arena"
            ref={arenaRef}
            role="group"
            aria-label="8 by 8 debugger arena"
            aria-keyshortcuts="Enter ArrowUp ArrowDown ArrowLeft ArrowRight Delete Backspace"
            tabIndex={0}
            style={{
              aspectRatio: `${DEBUGGER_ARENA_WIDTH} / ${DEBUGGER_ARENA_HEIGHT}`,
              backgroundSize: `${100 / DEBUGGER_ARENA_WIDTH}% ${100 / DEBUGGER_ARENA_HEIGHT}%`,
            }}
            onKeyDown={handleArenaKeyDown}
            onDragOver={handleArenaDragOver}
            onDragLeave={handleArenaDragLeave}
            onDrop={handleArenaDrop}
          >
            <div className="debugger-arena-grid">
              {Array.from({ length: DEBUGGER_ARENA_WIDTH * DEBUGGER_ARENA_HEIGHT }, (_, index) => {
                const x = index % DEBUGGER_ARENA_WIDTH;
                const y = Math.floor(index / DEBUGGER_ARENA_WIDTH);
                return (
                  <button
                    className={`debugger-arena-cell${placementType ? ' is-placement-target' : ''}${dropTarget?.x === x && dropTarget?.y === y ? ' is-drop-target' : ''}`}
                    key={`${x}-${y}`}
                    type="button"
                    data-grid-x={x}
                    data-grid-y={y}
                    aria-label={`Grid square x ${x}, y ${y}`}
                    title={`x ${x}, y ${y}`}
                    onClick={handleSquareClick}
                  />
                );
              })}
            </div>
            {dropTarget && draggedObject.current &&
              (draggedObject.current.type === 'bullet' || draggedObject.current.objectType === 'bullet') && (
              <span
                className="debugger-bullet-drop-target"
                aria-hidden="true"
                style={{
                  left: `${((dropTarget.x + 0.5) / DEBUGGER_ARENA_WIDTH) * 100}%`,
                  top: `${((dropTarget.y + 0.5) / DEBUGGER_ARENA_HEIGHT) * 100}%`,
                }}
              />
            )}
            {scenario.allTanks.map((tank) => {
              const isPlayer = tank.id === scenario.tankId;
              const isSelected = selectedObject?.type === 'tank' && selectedObject.id === tank.id;
              return (
                <Fragment key={tank.id}>
                  <BattleTank
                    {...tank}
                    color={isPlayer ? tankColor : ENEMY_TANK_COLOR}
                    arenaWidth={DEBUGGER_ARENA_WIDTH}
                    arenaHeight={DEBUGGER_ARENA_HEIGHT}
                  />
                  <button
                    className={`debugger-object-target debugger-tank-target${isPlayer ? ' is-player' : ''}${isSelected ? ' is-selected' : ''}`}
                    type="button"
                    aria-label={`${isPlayer ? 'Your tank' : 'Dummy tank'}, ${tank.name}, x ${tank.x}, y ${tank.y}, rotation ${tank.rotation}, health ${tank.health}`}
                    aria-pressed={isSelected}
                    draggable
                    style={{
                      left: `${((tank.x + 0.5) / DEBUGGER_ARENA_WIDTH) * 100}%`,
                      top: `${((tank.y + 0.5) / DEBUGGER_ARENA_HEIGHT) * 100}%`,
                    }}
                    onClick={() => {
                      setPlacementType(null);
                      setSelectedObject({ type: 'tank', id: tank.id });
                    }}
                    onFocus={() => setSelectedObject({ type: 'tank', id: tank.id })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedObject({ type: 'tank', id: tank.id });
                      }
                    }}
                    onDragStart={(event) => handleObjectDragStart(event, { type: 'tank', id: tank.id })}
                    onDragEnd={handleObjectDragEnd}
                  />
                </Fragment>
              );
            })}
            {scenario.allBullets.map((bullet) => {
              const isSelected = selectedObject?.type === 'bullet' && selectedObject.id === bullet.id;
              return (
                <Fragment key={bullet.id}>
                  <BattleBullet
                    {...bullet}
                    arenaWidth={DEBUGGER_ARENA_WIDTH}
                    arenaHeight={DEBUGGER_ARENA_HEIGHT}
                    showDirection
                  />
                  <button
                    className={`debugger-object-target debugger-bullet-target${isSelected ? ' is-selected' : ''}`}
                    type="button"
                    aria-label={`Bullet ${bullet.id}, owner ${bullet.ownerId}, x ${bullet.x}, y ${bullet.y}, rotation ${bullet.rotation}`}
                    aria-pressed={isSelected}
                    draggable
                    style={{
                      left: `${((bullet.x + 0.5) / DEBUGGER_ARENA_WIDTH) * 100}%`,
                      top: `${((bullet.y + 0.5) / DEBUGGER_ARENA_HEIGHT) * 100}%`,
                    }}
                    onClick={() => {
                      setPlacementType(null);
                      setSelectedObject({ type: 'bullet', id: bullet.id });
                    }}
                    onFocus={() => setSelectedObject({ type: 'bullet', id: bullet.id })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedObject({ type: 'bullet', id: bullet.id });
                      }
                    }}
                    onDragStart={(event) => handleObjectDragStart(event, { type: 'bullet', id: bullet.id })}
                    onDragEnd={handleObjectDragEnd}
                  />
                </Fragment>
              );
            })}
          </div>
          <p className="debugger-arena-help">Drag objects to move them, or choose an object and click the arena. Bullets snap to cell centers or edge midpoints. Arrow keys move to the next valid position; tanks move by one cell. Press Enter in the arena to generate a command.</p>
          {placementMessage && (
            <p className="debugger-placement-message" role="status">{placementMessage}</p>
          )}
        </section>

        <aside className="debugger-side-panel">
          <section className="debugger-palette" aria-labelledby="debugger-palette-heading">
            <div className="debugger-section-heading">
              <div>
                <p className="tank-reference-label">OBJECTS</p>
                <h3 id="debugger-palette-heading">Palette</h3>
              </div>
            </div>
            <p className="debugger-panel-help">Drag an object into the arena or select it, then click a square.</p>
            <div className="debugger-palette-items">
              <button
                className={`debugger-palette-item${placementType === 'tank' ? ' is-active' : ''}`}
                type="button"
                draggable
                aria-pressed={placementType === 'tank'}
                onClick={() => {
                  setPlacementType(placementType === 'tank' ? null : 'tank');
                  setPlacementMessage('');
                }}
                onDragStart={(event) => handleObjectDragStart(event, { type: 'palette', objectType: 'tank' })}
                onDragEnd={handleObjectDragEnd}
              >
                <span className="debugger-palette-icon" aria-hidden="true">
                  <BattleTank
                    x={0}
                    y={0}
                    rotation={0}
                    name="Dummy Tank"
                    color={ENEMY_TANK_COLOR}
                    arenaWidth={1}
                    arenaHeight={1}
                  />
                </span>
                <span>Dummy enemy tank</span>
              </button>
              <button
                className={`debugger-palette-item${placementType === 'bullet' ? ' is-active' : ''}`}
                type="button"
                draggable
                aria-pressed={placementType === 'bullet'}
                onClick={() => {
                  setPlacementType(placementType === 'bullet' ? null : 'bullet');
                  setPlacementMessage('');
                }}
                onDragStart={(event) => handleObjectDragStart(event, { type: 'palette', objectType: 'bullet' })}
                onDragEnd={handleObjectDragEnd}
              >
                <span className="debugger-palette-icon" aria-hidden="true">
                  <BattleBullet
                    x={0}
                    y={0}
                    rotation={0}
                    arenaWidth={1}
                    arenaHeight={1}
                    showDirection
                  />
                </span>
                <span>Bullet</span>
              </button>
            </div>
          </section>

          <section className="debugger-inspector" aria-labelledby="debugger-inspector-heading">
            <div className="debugger-section-heading">
              <div>
                <p className="tank-reference-label">READ-ONLY STATE</p>
                <h3 id="debugger-inspector-heading">Inspector</h3>
              </div>
              {selectedData && (
                <span className={`debugger-object-badge${selectedIsPlayer ? ' is-player' : ''}`}>
                  {selectedIsPlayer ? 'YOUR TANK' : selectedTank ? 'DUMMY TANK' : 'BULLET'}
                </span>
              )}
            </div>
            {selectedData ? (
              <pre className="debugger-inspector-code" aria-label="Selected object data">
                <code>
                  <span className="debugger-code-punctuation">{'{'}</span>
                  {Object.entries(selectedData).map(([key, value], index) => (
                    <span className="debugger-code-line" key={key}>
                      <span className="debugger-code-key">{key}</span>
                      <span className="debugger-code-punctuation">: </span>
                      <span className={typeof value === 'string' ? 'debugger-code-string' : 'debugger-code-number'}>
                        {typeof value === 'string' ? `"${value}"` : value}
                      </span>
                      {index < Object.keys(selectedData).length - 1 && (
                        <span className="debugger-code-punctuation">,</span>
                      )}
                    </span>
                  ))}
                  <span className="debugger-code-punctuation">{'}'}</span>
                </code>
              </pre>
            ) : (
              <p className="debugger-inspector-empty">Select a tank or bullet to inspect its data.</p>
            )}
            {selectedData && (
              <div className="debugger-object-toolbar" role="group" aria-label="Selected object actions">
                <button
                  className="btn btn-secondary debugger-action-button"
                  type="button"
                  aria-label="Rotate Left"
                  title="Rotate left (90 degrees)"
                  onClick={() => rotateSelectedObject('left')}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M4.5 8A6 6 0 1 1 4 12M4.5 4.5V8H8" />
                  </svg>
                  <span>Rotate Left</span>
                </button>
                <button
                  className="btn btn-secondary debugger-action-button"
                  type="button"
                  aria-label="Rotate Right"
                  title="Rotate right (90 degrees)"
                  onClick={() => rotateSelectedObject('right')}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M15.5 8A6 6 0 1 0 16 12m-.5-7.5V8H12" />
                  </svg>
                  <span>Rotate Right</span>
                </button>
                {!selectedIsPlayer && (
                  <button
                    className="btn btn-outline-danger debugger-action-button"
                    type="button"
                    title="Delete selected object"
                    onClick={removeSelectedObject}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M4 6h12m-10 0 .7 10h6.6L14 6m-7-2h6m-5 5v4m4-4v4" />
                    </svg>
                    <span>Delete</span>
                  </button>
                )}
              </div>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
});
