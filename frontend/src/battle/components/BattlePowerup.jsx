import React from 'react';

export function PowerupIcon({ type }) {
  return (
    <svg className={`powerup-icon powerup-icon--${type}`} viewBox="0 0 24 24" aria-hidden="true">
      {type === 'heart' ? (
        <path d="M12 21 3.5 12.5C-2 6.5 6 0 12 6c6-6 14 .5 8.5 6.5Z" />
      ) : (
        <path d="M14 1 3 14h8l-1 9L21 9h-8Z" />
      )}
    </svg>
  );
}

export function BattlePowerup({ type, x, y, arenaWidth = 12, arenaHeight = 12 }) {
  const name = type === 'heart' ? 'Heart' : 'Lightning';
  return (
    <span
      className={`battle-powerup battle-powerup--${type}`}
      role="img"
      aria-label={`${name}, x ${x}, y ${y}`}
      title={type === 'heart' ? 'Heart: restores 1 HP, up to maximum health' : 'Lightning: doubles future bullet speed for the next 50 game ticks; collecting another resets the timer'}
      style={{
        left: `${((x + 0.5) / arenaWidth) * 100}%`,
        top: `${((y + 0.5) / arenaHeight) * 100}%`,
        width: `${60 / arenaWidth}%`,
        height: `${60 / arenaHeight}%`,
      }}
    >
      <PowerupIcon type={type} />
    </span>
  );
}
