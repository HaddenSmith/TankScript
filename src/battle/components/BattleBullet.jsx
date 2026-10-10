import React from 'react';

export function BattleBullet({
  x,
  y,
  rotation = 0,
  arenaWidth = 12,
  arenaHeight = 12,
}) {
  return (
    <span
      className="battle-bullet"
      aria-hidden="true"
      style={{
        left: `${((x + 0.5) / arenaWidth) * 100}%`,
        top: `${((y + 0.5) / arenaHeight) * 100}%`,
        width: `${44 / arenaWidth}%`,
        height: `${18 / arenaHeight}%`,
        transform: `translate(-50%, -50%) rotate(${-rotation}deg)`,
      }}
    />
  );
}
