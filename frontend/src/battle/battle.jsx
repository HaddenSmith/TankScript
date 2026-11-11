import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getAllTanks } from '../services/api';
import { builtInTanks } from '../game/builtInTanks/builtInTanks';
import { BattleEngine } from '../../../shared/game/engine/battleEngine.js';
import { BattleArena } from './components/BattleArena';
import {
  BATTLE_SPEED_OPTIONS,
  MAX_ARENA_SIZE,
  MIN_ARENA_SIZE,
  createBattleFromSelectedTanks,
  maxBattleParticipants,
} from '../../../shared/game/battleController.js';
import { createBattleEventsFromSnapshots, createBattleStateSnapshot } from '../../../shared/game/battleState.js';
import { connectHostedBattle } from './hostedBattle.js';

const DEFAULT_ARENA_SIZE = 12;
const DEFAULT_STARTING_HEALTH = 3;
const DEFAULT_TICK_INTERVAL_SECONDS = 0.5;
const MAX_BATTLE_EVENTS = 50;
const BUILT_IN_DIFFICULTY_ORDER = {
  easy: 0,
  medium: 1,
  hard: 2,
  expert: 3,
  overkill: 4,
};
const EMPTY_ARENA = {
  width: DEFAULT_ARENA_SIZE,
  height: DEFAULT_ARENA_SIZE,
  tanks: [],
  bullets: [],
};
const OFFICIAL_TANK_OPTIONS = [...builtInTanks]
  .sort((first, second) => (
    BUILT_IN_DIFFICULTY_ORDER[first.difficulty] -
      BUILT_IN_DIFFICULTY_ORDER[second.difficulty] ||
    first.name.localeCompare(second.name)
  ))
  .map((tank) => ({
    id: `builtin:${tank.id}`,
    label: tank.name,
    definition: tank,
  }));

const hostedByDefault = typeof __TANKSCRIPT_BACKEND_BATTLES__ !== 'undefined' && __TANKSCRIPT_BACKEND_BATTLES__;

export function Battle({ username, serverHosted = hostedByDefault }) {
  const [savedTanks, setSavedTanks] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [arenaSize, setArenaSize] = useState(DEFAULT_ARENA_SIZE);
  const [startingHealth, setStartingHealth] = useState(DEFAULT_STARTING_HEALTH);
  const [tickIntervalSeconds, setTickIntervalSeconds] = useState(DEFAULT_TICK_INTERVAL_SECONDS);
  const [loadError, setLoadError] = useState('');
  const [battlePhase, setBattlePhase] = useState('ready');
  const [battleError, setBattleError] = useState('');
  const [battleState, setBattleState] = useState(null);
  const [activeEffects, setActiveEffects] = useState([]);
  const [setupCollapsed, setSetupCollapsed] = useState(false);
  const arenaRef = useRef(null);
  const activeBattleRef = useRef(null);
  const hostedCleanupRef = useRef(null);
  const nextParticipantIdRef = useRef(1);
  const nextEffectIdRef = useRef(1);

  useEffect(() => {
    let active = true;
    setSavedTanks([]);
    setLoadError('');

    getAllTanks().then((result) => {
      if (!active) return;

      if (!result.ok) {
        setLoadError(result.error);
        return;
      }

      setSavedTanks(result.data);
    });

    return () => {
      active = false;
    };
  }, [username]);

  const communityTankOptions = useMemo(() => (
    [...savedTanks]
      .sort((first, second) => (
        first.name.localeCompare(second.name, undefined, { sensitivity: 'base' }) ||
        first.ownerUsername.localeCompare(second.ownerUsername, undefined, { sensitivity: 'base' }) ||
        first.id.localeCompare(second.id)
      ))
      .map((tank) => ({
        id: `saved:${JSON.stringify([tank.ownerUsername, tank.id])}`,
        label: `${tank.name} (${tank.ownerUsername})`,
        definition: tank,
      }))
  ), [savedTanks]);
  const participantQuantities = useMemo(() => (
    participants.reduce((quantities, participant) => {
      const currentQuantity = quantities.get(participant.definition) ?? 0;
      quantities.set(participant.definition, currentQuantity + 1);
      return quantities;
    }, new Map())
  ), [participants]);
  const hasValidSelections = participants.length >= 2;
  const maxParticipants = maxBattleParticipants(arenaSize);
  const canStartBattle = hasValidSelections && participants.length <= maxParticipants;
  const participantCount = participants.length;
  const tickIntervalLabel = tickIntervalSeconds === 1
    ? '1.0'
    : String(tickIntervalSeconds);
  const arena = battleState?.arena ?? {
    ...EMPTY_ARENA,
    width: arenaSize,
    height: arenaSize,
  };
  const events = battleState?.events ?? [];
  const result = battleState?.result ?? null;
  const tickCount = battleState?.tickCount ?? 0;
  const battleStatus = {
    ready: 'READY',
    starting: 'INITIALIZING TANKSCRIPTS...',
    running: 'EXECUTING TANKSCRIPTS...',
    paused: 'BATTLE PAUSED',
    complete: 'BATTLE COMPLETE',
    stopped: 'BATTLE STOPPED',
  }[battlePhase];

  const stopBattle = useCallback(() => {
    const battle = activeBattleRef.current;
    activeBattleRef.current = null;
    battle?.controller.abort();
    if (battle?.hosted) hostedCleanupRef.current = battle.hosted.dispose();
    return hostedCleanupRef.current;
  }, []);

  useLayoutEffect(() => () => { void stopBattle(); }, [stopBattle]);

  const reportBattleError = useCallback((error, message = 'The TankScript runner stopped. Start a new battle to try again.') => {
    console.error('TankScript battle stopped:', error);
    stopBattle();
    setBattlePhase('stopped');
    setBattleError(message);
  }, [stopBattle]);

  async function handleStartBattle(event) {
    event.preventDefault();
    if (!canStartBattle || (serverHosted && battlePhase === 'starting')) return;

    const previousCleanup = stopBattle();
    const engine = serverHosted ? null : createBattleFromSelectedTanks(
      participants.map((participant) => participant.definition),
      arenaSize,
      startingHealth,
    );
    const battle = {
      engine,
      controller: new AbortController(),
      runner: null,
      pendingTick: null,
      tickStartedAt: null,
      paused: false,
      serverHosted,
      requestedSpeed: tickIntervalSeconds,
    };
    activeBattleRef.current = battle;
    const snapshot = engine ? createBattleStateSnapshot(engine, startingHealth) : null;
    const startEvents = [
      `Battle started: ${participants.map((participant, index) =>
        `Tank #${index + 1} (${participant.definition.name})`,
      ).join(', ')}.`,
    ];
    setActiveEffects([]);
    setBattleError('');
    setBattleState(snapshot ? { ...snapshot, events: startEvents, result: null, tickCount: 0 } : null);
    setBattlePhase('starting');
    setSetupCollapsed(true);
    window.requestAnimationFrame(() => {
      if (activeBattleRef.current !== battle) return;
      const arenaElement = arenaRef.current?.querySelector('.battle-arena')
        ?? arenaRef.current;
      const prefersReducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      arenaElement?.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    });

    try {
      if (serverHosted) {
        await previousCleanup;
        if (activeBattleRef.current !== battle) return;
        const speed = battle.requestedSpeed;
        battle.hosted = await connectHostedBattle({
          participants: participants.map(({ definition, type }) => ({ type, id: definition.id })),
          arenaSize, startingHealth, speed,
        }, {
          signal: battle.controller.signal,
          onUpdate(update, effects, resync) {
            if (activeBattleRef.current !== battle) return;
            setBattleState(update.state);
            setBattlePhase(update.phase);
            if (resync || effects.length) {
              setActiveEffects(current => resync ? effects : [...current, ...effects]);
            }
            battle.serverError = update.error?.message ?? '';
            battle.serverSpeed = update.speed;
            setBattleError(battle.serverError || battle.controlError || '');
          },
          onConnectionError(message) {
            if (activeBattleRef.current === battle) setBattleError(battle.serverError || message || battle.controlError || '');
          },
          onFailure(error) {
            if (activeBattleRef.current === battle) reportBattleError(error, error.message);
          },
        });
        if (activeBattleRef.current !== battle) {
          void battle.hosted.dispose();
        } else if (battle.requestedSpeed !== speed) {
          void applyHostedControl(battle, battle.hosted.setSpeed(battle.requestedSpeed), battle.requestedSpeed);
        }
        return;
      }
      const { createTankScriptBattleRunner } = await import('../game/tank-script/tankScriptWorkerRunner');
      if (activeBattleRef.current !== battle) return;

      const tanks = engine.arena.tanks.map((tank) => ({ tankId: tank.id, source: tank.code }));
      battle.runner = await createTankScriptBattleRunner(tanks, { signal: battle.controller.signal });
      if (activeBattleRef.current !== battle) {
        await battle.runner.dispose();
        return;
      }
      setBattlePhase('running');
    } catch (error) {
      if (activeBattleRef.current === battle) {
        reportBattleError(error, serverHosted ? error.message : undefined);
        if (serverHosted) setSetupCollapsed(false);
      }
    }
  }

  const removeActiveEffect = useCallback((effectId) => {
    setActiveEffects((currentEffects) => (
      currentEffects.filter((effect) => effect.id !== effectId)
    ));
  }, []);

  useLayoutEffect(() => {
    const battle = activeBattleRef.current;
    if (battlePhase !== 'running' || !battle || battle.serverHosted) return;

    let active = true;
    const elapsed = battle.tickStartedAt === null ? 0 : performance.now() - battle.tickStartedAt;
    const delay = battle.pendingTick ? 0 : Math.max(0, tickIntervalSeconds * 1000 - elapsed);
    const timer = window.setTimeout(async () => {
      if (activeBattleRef.current !== battle || battle.paused) return;

      try {
        // Keep the same batch if the player pauses or changes speed during execution.
        if (!battle.pendingTick) {
          battle.tickStartedAt = performance.now();
          battle.pendingTick = battle.runner.runTick(battle.engine.getTankScriptStates());
        }
        const { results } = await battle.pendingTick;
        if (!active || activeBattleRef.current !== battle || battle.paused) return;
        battle.pendingTick = null;

        const commands = {};
        for (const { tankId, command } of results) {
          if (command) commands[tankId] = command.action;
        }
        const tickResult = battle.engine.resolveTick(commands);
        const snapshot = createBattleStateSnapshot(battle.engine, startingHealth);
        const tickEffects = battle.engine.getLastTickEvents().map((effect) => ({
          ...effect,
          id: nextEffectIdRef.current++,
        }));
        if (tickEffects.length > 0) {
          setActiveEffects((currentEffects) => [...currentEffects, ...tickEffects]);
        }
        const newEvents = createBattleEventsFromSnapshots(battleState, snapshot, tickResult);
        const nextEvents = [...battleState.events, ...newEvents].slice(-MAX_BATTLE_EVENTS);
        setBattleState({
          ...snapshot,
          events: nextEvents,
          result: tickResult,
          tickCount: battle.engine.getTickCount(),
        });

        if (tickResult !== null) {
          setBattlePhase('complete');
          battle.runner.dispose().catch((error) => {
            if (!battle.controller.signal.aborted) console.error('Could not clean up the battle runner:', error);
          }).finally(() => {
            if (activeBattleRef.current === battle) activeBattleRef.current = null;
          });
        }
      } catch (error) {
        if (activeBattleRef.current === battle) reportBattleError(error);
      }
    }, delay);

    // Schedule from the committed snapshot so slow batches never queue extra ticks.
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [battlePhase, battleState, tickIntervalSeconds, startingHealth, reportBattleError]);

  function togglePause() {
    const battle = activeBattleRef.current;
    if (battle?.hosted) {
      const request = battlePhase === 'paused' ? battle.hosted.resume() : battle.hosted.pause();
      void applyHostedControl(battle, request);
      return;
    }
    if (!battle?.runner) return;

    battle.paused = !battle.paused;
    if (!battle.paused) battle.tickStartedAt = null;
    setBattlePhase(battle.paused ? 'paused' : 'running');
  }

  async function applyHostedControl(battle, request, speed) {
    try {
      await request;
      if (activeBattleRef.current === battle) battle.controlError = '';
    } catch (error) {
      if (activeBattleRef.current === battle) {
        battle.controlError = error.status ? error.message : 'Could not reach the server to change the battle.';
        if (speed !== undefined && speed === battle.requestedSpeed) {
          battle.requestedSpeed = battle.serverSpeed;
          setTickIntervalSeconds(battle.serverSpeed);
        }
        setBattleError(battle.controlError);
      }
    }
  }

  function resetBattle() {
    stopBattle();
    setBattlePhase('ready');
    setBattleError('');
    setBattleState(null);
    setActiveEffects([]);
    setSetupCollapsed(false);
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
    const speed = BATTLE_SPEED_OPTIONS[Number(event.target.value)];
    setTickIntervalSeconds(speed);
    const battle = activeBattleRef.current;
    if (battle?.serverHosted) {
      battle.requestedSpeed = speed;
      if (battle.hosted) void applyHostedControl(battle, battle.hosted.setSpeed(speed), speed);
    }
  }

  function handleAddParticipant(option) {
    if (participantCount >= maxParticipants) return;

    setParticipants((currentParticipants) => [
      ...currentParticipants,
      {
        selectionId: nextParticipantIdRef.current,
        definition: option.definition,
        type: option.id.startsWith('builtin:') ? 'official' : 'community',
      },
    ]);
    nextParticipantIdRef.current += 1;
    resetBattle();
  }

  function handleRemoveParticipant(option) {
    let participantIndex = -1;
    for (let index = participants.length - 1; index >= 0; index -= 1) {
      if (participants[index].definition === option.definition) {
        participantIndex = index;
        break;
      }
    }
    if (participantIndex < 0) return;

    setParticipants((currentParticipants) => [
      ...currentParticipants.slice(0, participantIndex),
      ...currentParticipants.slice(participantIndex + 1),
    ]);
    resetBattle();
  }

  function renderTankOption(option) {
    const quantity = participantQuantities.get(option.definition) ?? 0;
    return (
      <li
        className={`battle-tank-option${quantity > 0 ? ' battle-tank-option--selected' : ''}`}
        key={option.id}
      >
        <div className="battle-tank-option-name">
          <span
            className="battle-roster-swatch"
            style={{ backgroundColor: option.definition.color }}
            aria-hidden="true"
          />
          <span>{option.label}</span>
        </div>
        <div className="battle-tank-quantity">
          <button
            className="battle-quantity-button"
            type="button"
            onClick={() => handleRemoveParticipant(option)}
            disabled={quantity === 0}
            aria-label={`Remove one ${option.label}`}
          >
            −
          </button>
          <output aria-label={`${quantity} ${option.label} selected`}>
            {quantity}
          </output>
          <button
            className="battle-quantity-button"
            type="button"
            onClick={() => handleAddParticipant(option)}
            disabled={participantCount >= maxParticipants}
            aria-label={`Add one ${option.label}`}
          >
            +
          </button>
        </div>
      </li>
    );
  }

  const setupSummary = `${participantCount} ${participantCount === 1 ? 'tank' : 'tanks'} • `
    + `${arenaSize} × ${arenaSize} • ${startingHealth} HP • ${tickIntervalLabel}s/tick`;

  return (
    <main className="battle-page">
      <h1>Battle Arena</h1>

      <section className="battle-setup" aria-labelledby="setup-heading">
        {setupCollapsed ? (
          <div className="battle-setup-summary">
            <div>
              <p className="battle-label">BATTLE CONTROL</p>
              <h2 id="setup-heading">Battle Setup</h2>
              <p>{setupSummary}</p>
            </div>
            <button
              className="btn btn-outline-primary"
              type="button"
              onClick={() => setSetupCollapsed(false)}
            >
              Edit Setup
            </button>
          </div>
        ) : (
          <>
            <p className="battle-label">BATTLE CONTROL</p>
            <h2 id="setup-heading">Battle Setup</h2>
            <form onSubmit={handleStartBattle}>
              <fieldset>
                <div className="battle-field mb-3">
                  <div className="battle-roster-heading">
                    <h3>Tanks</h3>
                    <span aria-live="polite">{participantCount} / {maxParticipants} selected</span>
                  </div>
                  {participantCount > maxParticipants && (
                    <p className="battle-field-help" role="alert">
                      Remove {participantCount - maxParticipants} tank
                      {participantCount - maxParticipants === 1 ? '' : 's'} to fit this arena.
                    </p>
                  )}
                  <ul className="battle-tank-selector">
                    <li className="battle-tank-group-heading">
                      <h4>Community Tanks</h4>
                    </li>
                    {communityTankOptions.length === 0 && !loadError ? (
                      <li className="battle-tank-empty">No community tanks available yet.</li>
                    ) : communityTankOptions.map(renderTankOption)}
                    <li className="battle-tank-group-heading">
                      <h4>Official Tanks</h4>
                    </li>
                    {OFFICIAL_TANK_OPTIONS.map(renderTankOption)}
                  </ul>
                  <p className="battle-field-help">
                    Select at least two tanks. You can add the same tank more than once.
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
                        {tickIntervalLabel} seconds per tick
                      </output>
                    </div>
                    <input
                      className="form-range"
                      id="battle-speed"
                      name="battle-speed"
                      type="range"
                      min="0"
                      max={BATTLE_SPEED_OPTIONS.length - 1}
                      step="1"
                      value={BATTLE_SPEED_OPTIONS.indexOf(tickIntervalSeconds)}
                      onChange={handleBattleSpeedChange}
                      aria-valuetext={`${tickIntervalLabel} seconds per tick`}
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
                    disabled={!canStartBattle || (serverHosted && battlePhase === 'starting')}
                  >
                    Start Battle
                  </button>
                </div>
              </fieldset>
            </form>
          </>
        )}
      </section>

      <div className="battle-arena-layout">
        <section
          className="battle-arena-panel"
          aria-labelledby="arena-heading"
          ref={arenaRef}
          tabIndex="-1"
        >
          <div className="battle-arena-heading">
            <div>
              <p className="battle-label">LIVE SIMULATION</p>
              <h2 id="arena-heading">Battle Arena</h2>
            </div>
            <div className="battle-arena-metrics">
              <span className="battle-tick-count">
                TICK {tickCount} / {BattleEngine.MAX_TICKS}
              </span>
              <span className="battle-arena-size">{arena.width} × {arena.height}</span>
            </div>
          </div>
          {(battleState || (serverHosted && battlePhase === 'starting')) && (
            <div className="battle-control-actions">
              {(battlePhase === 'running' || battlePhase === 'paused') && (
                <button className="btn btn-outline-primary" type="button" onClick={togglePause}>
                  {battlePhase === 'paused' ? 'Resume Battle' : 'Pause Battle'}
                </button>
              )}
              <button className="btn btn-outline-primary" type="button" onClick={resetBattle}>
                Reset Battle
              </button>
            </div>
          )}
          {battleError && <p className="alert alert-danger" role="alert">{battleError}</p>}
          {result && (
            <div
              className={`alert ${result.status === 'win' ? 'alert-success' : 'alert-info'}`}
              role="status"
            >
              <h3 className="h5 mb-1">Battle Results</h3>
              <p className="mb-0">{getBattleResultMessage(result)}</p>
            </div>
          )}
          <BattleArena
            width={arena.width}
            height={arena.height}
            tanks={arena.tanks}
            bullets={arena.bullets}
            effects={activeEffects}
            startingHealth={startingHealth}
            status={battleStatus}
            onEffectComplete={removeActiveEffect}
            emptyMessage="Select tanks and start a battle to display the arena."
          />
        </section>

        <aside className="battle-info-panel" aria-labelledby="info-heading">
          <p className="battle-label">PARTICIPANT DATA</p>
          <h2 id="info-heading">Battle Info</h2>
          <div className="battle-participant-list">
            {battleState ? (
              arena.tanks.map((tank) => (
                <BattleParticipant key={tank.id} tank={tank} />
              ))
            ) : (
              <p className="battle-empty-state">Start a battle to view live tank state.</p>
            )}
          </div>
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
  const isAlive = tank.health > 0;

  return (
    <section
      className={`battle-participant ${
        isAlive ? 'battle-participant--alive' : 'battle-participant--destroyed'
      }`}
      aria-label={`Tank ${tank.id} live state`}
    >
      <h3>Tank #{tank.id}: {tank.name ?? '—'}</h3>
      <dl>
        <dt>Color</dt>
        <dd>
          <span
            className="battle-roster-swatch"
            style={{ backgroundColor: tank.color }}
            aria-hidden="true"
          />
          {' '}{tank.color}
        </dd>
        <dt>Health</dt><dd>{tank.health ?? '—'}</dd>
        <dt>Kills</dt><dd>{tank.killCount ?? 0}</dd>
        <dt>Position</dt>
        <dd>{tank.x !== undefined && tank.y !== undefined ? `[${tank.x}, ${tank.y}]` : '—'}</dd>
        <dt>Direction</dt><dd>{tank.rotation !== undefined ? `${tank.rotation}°` : '—'}</dd>
        <dt>Status</dt>
        <dd>
          <span className={`battle-participant-status ${
            isAlive ? 'battle-participant-status--alive' : 'battle-participant-status--destroyed'
          }`}>
            {isAlive ? 'Alive' : 'Destroyed'}
          </span>
        </dd>
      </dl>
    </section>
  );
}

function getBattleResultMessage(result) {
  const hasWinner = result.status === 'win' && result.winner;
  const winnerName = hasWinner
    ? `Tank #${result.winner.id} (${result.winner.name ?? 'Unnamed tank'})`
    : null;

  switch (result.reason) {
    case 'elimination':
      return winnerName
        ? `${winnerName} wins! Last tank standing.`
        : 'Draw! No winner was determined.';
    case 'timeout':
      return winnerName
        ? `${winnerName} wins on kills! Maximum tick limit reached.`
        : 'Draw! Maximum tick limit reached.';
    case 'stalemate':
      return winnerName
        ? `${winnerName} wins on kills! No damage for ${BattleEngine.MAX_NO_PROGRESS_TICKS} ticks.`
        : `Draw! No damage for ${BattleEngine.MAX_NO_PROGRESS_TICKS} ticks.`;
    case 'mutual-destruction':
      return 'Draw! All tanks destroyed.';
    default:
      return winnerName ? `${winnerName} wins!` : "It's a draw!";
  }
}
