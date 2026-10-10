import React from 'react';
import { BattleTank } from './BattleTank';
import { BattleBullet } from './BattleBullet';

export function BattleArena({
  width = 12,
  height = 12,
  tanks = [],
  bullets = [],
  emptyMessage = 'Arena state is not available.',
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
      {tanks
        .filter((tank) => tank.health > 0)
        .map((tank, index) => (
          <BattleTank
            key={tank.id ?? `tank-${index}`}
            {...tank}
            arenaWidth={width}
            arenaHeight={height}
            variant={index % 2 === 0 ? 'player' : 'opponent'}
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
