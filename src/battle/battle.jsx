import React, { useCallback, useEffect, useRef, useState } from 'react';
import { loadAllTanks } from '../tank-editor/tankStorage';
import { builtInTanks } from '../game/builtInTanks/builtInTanks';
import { TANK_COLORS } from '../game/tankColors';
import { BattleArena } from './components/BattleArena';
import { createBattleFromSelectedTanks } from './battleController';
import { createBattleEventsFromSnapshots, createBattleStateSnapshot } from './battleState';

const MIN_ARENA_SIZE = 8;
const MAX_ARENA_SIZE = 20;
const DEFAULT_ARENA_SIZE = 12;
const DEFAULT_STARTING_HEALTH = 3;
const DEFAULT_TICK_INTERVAL_SECONDS = 1;
const MAX_BATTLE_EVENTS = 50;
const EMPTY_ARENA = {
  width: DEFAULT_ARENA_SIZE,
  height: DEFAULT_ARENA_SIZE,
  tanks: [],
  bullets: [],
};

export function Battle({ username }) {
  const [savedTanks, setSavedTanks] = useState([]);
  const [selectedTankOptionId, setSelectedTankOptionId] = useState('');
  const [participants, setParticipants] = useState([]);
  const [arenaSize, setArenaSize] = useState(DEFAULT_ARENA_SIZE);
  const [startingHealth, setStartingHealth] = useState(DEFAULT_STARTING_HEALTH);
  const [tickIntervalSeconds, setTickIntervalSeconds] = useState(DEFAULT_TICK_INTERVAL_SECONDS);
  const [loadError, setLoadError] = useState('');
  const [battleStarted, setBattleStarted] = useState(false);
  const [battleState, setBattleState] = useState(null);
  const engineRef = useRef(null);
  const previousSnapshotRef = useRef(null);
  const battleEventsRef = useRef([]);
  const nextParticipantIdRef = useRef(1);

  useEffect(() => {
    try {
      setSavedTanks(loadAllTanks());
    } catch (error) {
      setLoadError(`Could not load tank options: ${error.message}`);
    }
  }, [username]);

  const tankOptions = [
    ...builtInTanks.map((tank) => ({
      id: `builtin:${tank.id}`,
      label: `Built-in — ${tank.name}`,
      definition: tank,
    })),
    ...savedTanks.map((tank) => ({
      id: `saved:${JSON.stringify([tank.owner, tank.id])}`,
      label: `${tank.name} (${tank.owner})`,
      definition: tank,
    })),
  ];
  const hasValidSelections = participants.length >= 2;
  const maxParticipants = Math.min(12, Math.floor(arenaSize / 2) + 2);
  const canStartBattle = hasValidSelections && participants.length <= maxParticipants;
  const arena = battleState?.arena ?? {
    ...EMPTY_ARENA,
    width: arenaSize,
    height: arenaSize,
  };
  const events = battleState?.events ?? [];
  const result = battleState?.result ?? null;
  const battleStatus = result
    ? 'BATTLE COMPLETE'
    : battleStarted
      ? 'EXECUTING TANKSCRIPTS...'
      : 'READY';

  function handleStartBattle(event) {
    event.preventDefault();
    if (!canStartBattle) return;

    engineRef.current = createBattleFromSelectedTanks(
      participants.map((participant) => participant.definition),
      arenaSize,
      startingHealth,
    );
    const snapshot = createBattleStateSnapshot(engineRef.current, startingHealth);
    const startEvents = [
      `Battle started: ${participants.map((participant, index) =>
        `Tank #${index + 1} (${participant.definition.name})`,
      ).join(', ')}.`,
    ];
    previousSnapshotRef.current = snapshot;
    battleEventsRef.current = startEvents;
    setBattleState({ ...snapshot, events: startEvents, result: null });
    setBattleStarted(true);
  }

  const advanceBattleOneTick = useCallback(() => {
    if (!engineRef.current) return;

    const previousSnapshot = previousSnapshotRef.current;
    const tickResult = engineRef.current.tick();
    const snapshot = createBattleStateSnapshot(engineRef.current, startingHealth);
    const newEvents = createBattleEventsFromSnapshots(
      previousSnapshot,
      snapshot,
      tickResult,
    );
    const nextEvents = [...battleEventsRef.current, ...newEvents].slice(-MAX_BATTLE_EVENTS);

    previousSnapshotRef.current = snapshot;
    battleEventsRef.current = nextEvents;
    setBattleState({ ...snapshot, events: nextEvents, result: tickResult });

    if (tickResult !== null) {
      setBattleStarted(false);
    }
  }, [startingHealth]);

  useEffect(() => {
    if (!battleStarted || result !== null) return undefined;

    // setInterval repeatedly advances one engine tick at the chosen speed.
    const intervalId = window.setInterval(
      advanceBattleOneTick,
      tickIntervalSeconds * 1000,
    );

    // Clear the old timer on reset, unmount, speed change, or timer replacement.
    // A speed change reruns this effect with the new interval and keeps the same battle.
    return () => window.clearInterval(intervalId);
  }, [battleStarted, result, tickIntervalSeconds, advanceBattleOneTick]);

  function resetBattle() {
    setBattleStarted(false);
    setBattleState(null);
    engineRef.current = null;
    previousSnapshotRef.current = null;
    battleEventsRef.current = [];
  }

  function handleArenaSizeChange(event) {
    setArenaSize(Number(event.target.value));
    resetBattle();
  }

  function handleStartingHealthChange(event) {
    setStartingHealth(Number(event.target.value));
    resetBattle();
  }

  function handleBattleSpeedChange(event) {
    setTickIntervalSeconds(Number(event.target.value));
  }

  function handleAddParticipant() {
    const selectedOption = tankOptions.find((option) => option.id === selectedTankOptionId);
    if (!selectedOption || participants.length >= maxParticipants) return;

    setParticipants((currentParticipants) => [
      ...currentParticipants,
      {
        selectionId: nextParticipantIdRef.current,
        definition: selectedOption.definition,
      },
    ]);
    nextParticipantIdRef.current += 1;
    setSelectedTankOptionId('');
    resetBattle();
  }

  function handleRemoveParticipant(selectionId) {
    setParticipants((currentParticipants) =>
      currentParticipants.filter((participant) => participant.selectionId !== selectionId),
    );
    resetBattle();
  }

  return (
    <main className="battle-page">
      <h1>Battle Arena</h1>

      <section className="battle-setup" aria-labelledby="setup-heading">
        <p className="battle-label">BATTLE CONTROL</p>
        <h2 id="setup-heading">Battle Setup</h2>
        <form onSubmit={handleStartBattle}>
          <fieldset>
            <div className="battle-field mb-3">
              <label htmlFor="battle-tank-option">Add a tank participant</label>
              <div className="battle-participant-controls">
                <select
                  className="form-select"
                  id="battle-tank-option"
                  name="battle-tank-option"
                  value={selectedTankOptionId}
                  onChange={(event) => setSelectedTankOptionId(event.target.value)}
                >
                  <option value="">Choose a tank</option>
                  {tankOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={handleAddParticipant}
                  disabled={!selectedTankOptionId || participants.length >= maxParticipants}
                >
                  Add Tank
                </button>
              </div>
              {tankOptions.length === 0 && !loadError && (
                <p className="battle-field-help">Create a tank in Tank Editor before setting up a battle.</p>
              )}
              <div className="battle-roster-heading">
                <h3>Tanks in Battle</h3>
                <span aria-live="polite">{participants.length} / {maxParticipants} tanks</span>
              </div>
              {participants.length > maxParticipants && (
                <p className="battle-field-help" role="alert">
                  Remove {participants.length - maxParticipants} tank{participants.length - maxParticipants === 1 ? '' : 's'} to fit this arena.
                </p>
              )}
              <ul className="battle-participant-list">
                {participants.length === 0 ? (
                  <li className="battle-roster-empty">No tanks added yet.</li>
                ) : participants.map((participant, index) => (
                  <li className="battle-roster-row" key={participant.selectionId}>
                    <span className="battle-roster-number">{index + 1}.</span>
                    <span className="battle-roster-name">{participant.definition.name}</span>
                    <span className="battle-roster-color">
                      <span
                        className={`battle-roster-swatch battle-roster-swatch--${participant.definition.color}`}
                        aria-hidden="true"
                      />
                      {TANK_COLORS.find((color) => color.value === participant.definition.color)?.label
                        ?? participant.definition.color}
                    </span>
                    <button
                      className="btn btn-sm btn-outline-danger"
                      type="button"
                      onClick={() => handleRemoveParticipant(participant.selectionId)}
                      aria-label={`Remove ${participant.definition.name} participant ${index + 1}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <p className="battle-field-help">
                Add at least two tanks to battle. You can add the same tank more than once.
              </p>
            </div>
            <div className="battle-config-grid">
              <div className="battle-size-control">
                <div className="battle-size-heading">
                  <label htmlFor="arena-size">Arena size</label>
                  <output htmlFor="arena-size">{arenaSize} × {arenaSize}</output>
                </div>
                <input
                  className="form-range"
                  id="arena-size"
                  name="arena-size"
                  type="range"
                  min={MIN_ARENA_SIZE}
                  max={MAX_ARENA_SIZE}
                  step="1"
                  value={arenaSize}
                  onChange={handleArenaSizeChange}
                  aria-describedby="arena-size-help"
                />
                <p className="battle-field-help" id="arena-size-help">
                  Choose a square arena from {MIN_ARENA_SIZE} × {MIN_ARENA_SIZE} to {MAX_ARENA_SIZE} × {MAX_ARENA_SIZE}.
                </p>
              </div>
              <div className="battle-size-control battle-health-control">
                <div className="battle-size-heading">
                  <label htmlFor="starting-health">Starting tank health</label>
                  <output htmlFor="starting-health">{startingHealth}</output>
                </div>
                <input
                  className="form-range"
                  id="starting-health"
                  name="starting-health"
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={startingHealth}
                  onChange={handleStartingHealthChange}
                  aria-describedby="starting-health-help"
                />
                <p className="battle-field-help" id="starting-health-help">
                  Every tank starts with this many health points.
                </p>
              </div>
              <div className="battle-size-control">
                <div className="battle-size-heading">
                  <label htmlFor="battle-speed">Battle Speed</label>
                  <output htmlFor="battle-speed">
                    {tickIntervalSeconds} seconds per tick
                  </output>
                </div>
                <input
                  className="form-range"
                  id="battle-speed"
                  name="battle-speed"
                  type="range"
                  min="0.25"
                  max="2"
                  step="0.25"
                  value={tickIntervalSeconds}
                  onChange={handleBattleSpeedChange}
                  aria-describedby="battle-speed-help"
                />
                <p className="battle-field-help" id="battle-speed-help">
                  Lower intervals advance the battle faster.
                </p>
              </div>
            </div>
            {loadError && <p className="alert alert-danger" role="alert">{loadError}</p>}
            <div className="battle-control-actions">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={!canStartBattle}
              >
                Start Battle
              </button>
            </div>
          </fieldset>
        </form>
      </section>

      <div className="battle-arena-layout">
        <section className="battle-arena-panel" aria-labelledby="arena-heading">
          <div className="battle-arena-heading">
            <div>
              <p className="battle-label">LIVE SIMULATION</p>
              <h2 id="arena-heading">Battle Arena</h2>
            </div>
            <span className="battle-arena-size">{arena.width} × {arena.height}</span>
          </div>
          {result && (
            <div
              className={`alert ${result.status === 'win' ? 'alert-success' : 'alert-info'}`}
              role="status"
            >
              <h3 className="h5 mb-1">Battle Results</h3>
              <p className="mb-0">
                {result.status === 'win'
                  ? `Tank #${result.winner.id} (${result.winner.name}) wins!`
                  : "It's a tie!"}
              </p>
            </div>
          )}
          <BattleArena
            width={arena.width}
            height={arena.height}
            tanks={arena.tanks}
            bullets={arena.bullets}
            startingHealth={startingHealth}
            status={battleStatus}
            emptyMessage={
              battleStarted
                ? 'Tank state will appear when the selected tanks are added to the engine.'
                : 'Select tanks and start a battle to display the arena.'
            }
          />
        </section>

        <aside className="battle-info-panel" aria-labelledby="info-heading">
          <p className="battle-label">PARTICIPANT DATA</p>
          <h2 id="info-heading">Battle Info</h2>
          {battleState ? (
            arena.tanks.map((tank) => (
              <BattleParticipant key={tank.id} tank={tank} />
            ))
          ) : (
            <p className="battle-empty-state">Start a battle to view live tank state.</p>
          )}
        </aside>
      </div>

      <section className="battle-feed-panel" aria-labelledby="events-heading">
        <p className="battle-label">EVENT STREAM</p>
        <h2 id="events-heading">Live Battle Feed</h2>
        <div id="realtime-battle-feed" aria-live="polite">
          {events.length > 0 ? (
            events.map((event, index) => <p key={`${index}-${event}`}>&gt; {event}</p>)
          ) : (
            <p className="battle-feed-empty">Battle events will appear here.</p>
          )}
        </div>
      </section>
    </main>
  );
}

function BattleParticipant({ tank }) {
  return (
    <section className="battle-participant" aria-label={`Tank ${tank.id} live state`}>
      <h3>Tank #{tank.id}: {tank.name ?? '—'}</h3>
      <dl>
        <dt>Color</dt>
        <dd>
          <span
            className={`battle-roster-swatch battle-roster-swatch--${tank.color}`}
            aria-hidden="true"
          />
          {' '}{TANK_COLORS.find((color) => color.value === tank.color)?.label ?? tank.color}
        </dd>
        <dt>Health</dt><dd>{tank.health ?? '—'}</dd>
        <dt>Kills</dt><dd>{tank.killCount ?? 0}</dd>
        <dt>Position</dt>
        <dd>{tank.x !== undefined && tank.y !== undefined ? `[${tank.x}, ${tank.y}]` : '—'}</dd>
        <dt>Direction</dt><dd>{tank.rotation !== undefined ? `${tank.rotation}°` : '—'}</dd>
        <dt>Status</dt><dd>{tank.health > 0 ? 'Alive' : 'Destroyed'}</dd>
      </dl>
    </section>
  );
}
