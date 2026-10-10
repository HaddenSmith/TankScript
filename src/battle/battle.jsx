import React, { useEffect, useRef, useState } from 'react';
import { loadAllTanks, loadTanks } from '../tank-editor/tankStorage';
import { builtInTanks } from '../game/builtInTanks/builtInTanks';
import { BattleArena } from './components/BattleArena';
import { createBattleFromSelectedTanks } from './battleController';

const MIN_ARENA_SIZE = 8;
const MAX_ARENA_SIZE = 20;
const DEFAULT_ARENA_SIZE = 12;
const DEFAULT_STARTING_HEALTH = 3;
const EMPTY_ARENA = {
  width: DEFAULT_ARENA_SIZE,
  height: DEFAULT_ARENA_SIZE,
  tanks: [],
  bullets: [],
};

export function Battle({ username }) {
  const [savedTanks, setSavedTanks] = useState([]);
  const [opponentTanks, setOpponentTanks] = useState([]);
  const [selectedPlayerTankId, setSelectedPlayerTankId] = useState('');
  const [selectedOpponentTankId, setSelectedOpponentTankId] = useState('');
  const [arenaSize, setArenaSize] = useState(DEFAULT_ARENA_SIZE);
  const [startingHealth, setStartingHealth] = useState(DEFAULT_STARTING_HEALTH);
  const [loadError, setLoadError] = useState('');
  const [battleStarted, setBattleStarted] = useState(false);
  const [battleState, setBattleState] = useState(null);
  const engineRef = useRef(null);

  useEffect(() => {
    try {
      setSavedTanks(loadTanks(username));
      setOpponentTanks(loadAllTanks());
    } catch (error) {
      setLoadError(`Could not load tank options: ${error.message}`);
    }
  }, [username]);

  const selectedPlayerTank = savedTanks.find(
    (tank) => String(tank.id) === selectedPlayerTankId,
  );
  const selectedBuiltInTank = builtInTanks.find(
    (tank) => `builtin:${tank.id}` === selectedOpponentTankId,
  );
  const selectedSavedOpponentTank = opponentTanks.find(
    (tank) => `saved:${JSON.stringify([tank.owner, tank.id])}` === selectedOpponentTankId,
  );
  const selectedOpponentTank = selectedBuiltInTank ?? selectedSavedOpponentTank;
  const hasValidSelections = Boolean(selectedPlayerTank && selectedOpponentTank);
  const arena = battleState?.arena ?? {
    ...EMPTY_ARENA,
    width: arenaSize,
    height: arenaSize,
  };
  const participants = battleState?.participants ?? {};
  const events = battleState?.events ?? [];
  const result = battleState?.result;
  const history = battleState?.history ?? [];

  function handleStartBattle(event) {
    event.preventDefault();
    if (!hasValidSelections) return;

    engineRef.current = createBattleFromSelectedTanks(
      selectedPlayerTank,
      selectedOpponentTank,
      arenaSize,
      startingHealth,
    );
    setBattleState(createBattleStateSnapshot(engineRef.current, startingHealth));
    setBattleStarted(true);
  }

  function handleNextTick() {
    if (!engineRef.current) return;

    engineRef.current.tick();

    setBattleState(createBattleStateSnapshot(engineRef.current, startingHealth));
  }

  function handleSelectionChange(setSelection, value) {
    setSelection(value);
    setBattleStarted(false);
    setBattleState(null);
    engineRef.current = null;
  }

  function handleArenaSizeChange(event) {
    setArenaSize(Number(event.target.value));
    setBattleStarted(false);
    setBattleState(null);
    engineRef.current = null;
  }

  function handleStartingHealthChange(event) {
    setStartingHealth(Number(event.target.value));
    setBattleStarted(false);
    setBattleState(null);
    engineRef.current = null;
  }

  return (
    <main className="battle-page">
      <h1>Battle Arena</h1>

      <section className="battle-setup" aria-labelledby="setup-heading">
        <p className="battle-label">BATTLE CONTROL</p>
        <h2 id="setup-heading">Battle Setup</h2>
        <form onSubmit={handleStartBattle}>
          <fieldset>
            <div className="battle-select-grid">
              <div className="battle-field mb-3">
                <label htmlFor="player-tank">Your Tank</label>
                <select
                  className="form-select"
                  id="player-tank"
                  name="player-tank"
                  value={selectedPlayerTankId}
                  onChange={(event) => handleSelectionChange(setSelectedPlayerTankId, event.target.value)}
                >
                  {savedTanks.length === 0 ? (
                    <option value="" disabled>No saved tanks</option>
                  ) : (
                    <>
                      <option value="">Select one of your tanks</option>
                      {savedTanks.map((tank) => (
                        <option key={tank.id} value={tank.id}>{tank.name}</option>
                      ))}
                    </>
                  )}
                </select>
                {savedTanks.length === 0 && !loadError && (
                  <p className="battle-field-help">Create a tank in Tank Editor before setting up a battle.</p>
                )}
              </div>
              <div className="battle-field mb-3">
                <label htmlFor="opponent-tank">Opponent</label>
                <select
                  className="form-select"
                  id="opponent-tank"
                  name="opponent-tank"
                  value={selectedOpponentTankId}
                  onChange={(event) => handleSelectionChange(setSelectedOpponentTankId, event.target.value)}
                >
                  <option value="">Select an opponent</option>
                  <optgroup label="Built-in Tanks">
                    {builtInTanks.map((tank) => (
                      <option key={tank.id} value={`builtin:${tank.id}`}>
                        Built-in — {tank.name}
                      </option>
                    ))}
                  </optgroup>
                  {opponentTanks.length > 0 && (
                    <optgroup label="Player Tanks">
                      {opponentTanks.map((tank) => {
                        const tankOptionId = `saved:${JSON.stringify([tank.owner, tank.id])}`;
                        return (
                          <option key={tankOptionId} value={tankOptionId}>
                            {tank.name} ({tank.owner})
                          </option>
                        );
                      })}
                    </optgroup>
                  )}
                </select>
              </div>
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
                  Both tanks start with this many health points.
                </p>
              </div>
            </div>
            {loadError && <p className="alert alert-danger" role="alert">{loadError}</p>}
            <div className="battle-control-actions">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={!hasValidSelections}
              >
                Start Battle
              </button>
              {battleStarted && (
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={handleNextTick}
                >
                  Next Tick
                </button>
              )}
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
          <BattleArena
            width={arena.width}
            height={arena.height}
            tanks={arena.tanks}
            bullets={arena.bullets}
            startingHealth={startingHealth}
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
          {battleStarted ? (
            <>
              <BattleParticipant title="Your Tank" tank={participants.player} />
              <BattleParticipant title="Opponent" tank={participants.opponent} />
            </>
          ) : (
            <p className="battle-empty-state">Participant data will appear when a battle is started.</p>
          )}
        </aside>
      </div>

      <section className="battle-feed-panel" aria-labelledby="events-heading">
        <p className="battle-label">EVENT STREAM</p>
        <h2 id="events-heading">Live Battle Feed</h2>
        {/* A future WebSocket connection can provide the same event strings. */}
        <div id="realtime-battle-feed" aria-live="polite">
          {events.length > 0 ? (
            events.map((event, index) => <p key={`${index}-${event}`}>&gt; {event}</p>)
          ) : (
            <p className="battle-feed-empty">Battle events will appear here.</p>
          )}
        </div>
      </section>

      <section className="battle-result-panel" aria-labelledby="results-heading">
        <p className="battle-label">OUTCOME</p>
        <h2 id="results-heading">Battle Result</h2>
        {result ? (
          <dl className="battle-result-list">
            <dt>Winner</dt>
            <dd>{result.winner ?? '—'}</dd>
            <dt>Final status</dt>
            <dd>{result.status ?? '—'}</dd>
            <dt>Battle statistics</dt>
            <dd>{result.statistics ?? '—'}</dd>
          </dl>
        ) : (
          <p className="battle-empty-state">Battle results will appear here when a battle is complete.</p>
        )}
      </section>

      <section className="battle-history-panel" aria-labelledby="history-heading">
        <h2 id="history-heading">Battle History</h2>
        {/* Future database data can provide previous battles and records. */}
        <table className="table table-striped table-hover battle-history-table">
          <caption>Previous battle records</caption>
          <thead>
            <tr>
              <th scope="col">Tank</th>
              <th scope="col">Wins</th>
              <th scope="col">Losses</th>
              <th scope="col">Recent result</th>
            </tr>
          </thead>
          <tbody>
            {history.length > 0 ? (
              history.map((entry, index) => (
                <tr key={entry.id ?? `${entry.tank}-${index}`}>
                  <td>{entry.tank}</td>
                  <td>{entry.wins}</td>
                  <td>{entry.losses}</td>
                  <td>{entry.recentResult}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="battle-history-empty" colSpan="4">No battle history yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function createBattleStateSnapshot(engine, startingHealth) {
  return {
    startingHealth,
    arena: {
      width: engine.arena.width,
      height: engine.arena.height,
      tanks: engine.arena.tanks.map((tank) => ({
        id: tank.id,
        name: tank.name,
        x: tank.x,
        y: tank.y,
        rotation: tank.rotation,
        health: tank.health,
      })),
      bullets: engine.arena.bullets.map((bullet) => ({
        id: bullet.id,
        ownerId: bullet.ownerId,
        x: bullet.x,
        y: bullet.y,
        rotation: bullet.rotation,
      })),
    },
  };
}

function BattleParticipant({ title, tank }) {
  return (
    <section className="battle-participant" aria-label={`${title} live state`}>
      <h3>{title}</h3>
      {tank ? (
        <dl>
          <dt>Name</dt><dd>{tank.name ?? '—'}</dd>
          <dt>Health</dt><dd>{tank.health ?? '—'}</dd>
          <dt>Position</dt>
          <dd>{tank.x !== undefined && tank.y !== undefined ? `[${tank.x}, ${tank.y}]` : '—'}</dd>
          <dt>Direction</dt><dd>{tank.rotation !== undefined ? `${tank.rotation}°` : '—'}</dd>
        </dl>
      ) : (
        <p className="battle-empty-state">Live state will appear when supplied by the BattleEngine.</p>
      )}
    </section>
  );
}
