import React from 'react';
import { BattleTank } from './BattleTank';
import { BattleBullet } from './BattleBullet';
import { BattleEffect } from './BattleEffect';
import { ScrambleText } from '../../components/ScrambleText';

export function BattleArena({
  width = 12,
  height = 12,
  tanks = [],
  bullets = [],
  effects = [],
  startingHealth = 3,
  status,
  emptyMessage = 'Arena state is not available.',
  onEffectComplete,
}) {
  const gridStyle = {
    aspectRatio: `${width} / ${height}`,
    backgroundSize: `${100 / width}% ${100 / height}%`,
  };

  return (
    <div
      className="battle-arena"
      role="group"
      aria-label={`${width} by ${height} tank battle arena`}
      style={gridStyle}
    >
      {status && (
        <div className="battle-status-overlay" role="status" aria-live="polite">
          <ScrambleText key={status} text={status} />
        </div>
      )}
      {effects.map((effect) => (
        <BattleEffect
          key={effect.id}
          {...effect}
          arenaWidth={width}
          arenaHeight={height}
          onComplete={onEffectComplete}
        />
      ))}
      {tanks
        .filter((tank) => tank.health > 0)
        .map((tank, index) => (
          <BattleTank
            key={tank.id ?? `tank-${index}`}
            {...tank}
            arenaWidth={width}
            arenaHeight={height}
            startingHealth={startingHealth}
          />
        ))}
      {bullets.map((bullet, index) => (
        <BattleBullet
          key={bullet.id ?? `bullet-${index}`}
          {...bullet}
          arenaWidth={width}
          arenaHeight={height}
        />
      ))}
      {tanks.length === 0 && bullets.length === 0 && (
        <p className="battle-arena-empty">{emptyMessage}</p>
      )}
    </div>
  );
}
