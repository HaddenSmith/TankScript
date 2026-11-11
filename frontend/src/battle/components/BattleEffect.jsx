import React, { useEffect } from 'react';

const EFFECT_DURATIONS = {
  'tank-destroyed': 400,
  'bullet-impact': 220,
};

export function BattleEffect({
  id,
  type,
  x,
  y,
  arenaWidth,
  arenaHeight,
  onComplete,
}) {
  const duration = EFFECT_DURATIONS[type];

  useEffect(() => {
    const timeoutId = window.setTimeout(() => onComplete(id), duration);
    return () => window.clearTimeout(timeoutId);
  }, [duration, id, onComplete]);

  const rayCount = type === 'tank-destroyed' ? 6 : 4;

  return (
    <span
      className={`battle-effect battle-effect--${type}`}
      aria-hidden="true"
      style={{
        left: `${((x + 0.5) / arenaWidth) * 100}%`,
        top: `${((y + 0.5) / arenaHeight) * 100}%`,
      }}
    >
      <span className="battle-effect__ring" />
      <span className="battle-effect__flash" />
      {Array.from({ length: rayCount }, (_, index) => (
        <span
          className="battle-effect__ray"
          key={`${id}-ray-${index}`}
          style={{ transform: `translate(-50%, -100%) rotate(${(360 / rayCount) * index}deg)` }}
        />
      ))}
    </span>
  );
}
