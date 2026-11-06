import React from 'react';

export function BattleBullet({
  x,
  y,
  rotation = 0,
  arenaWidth = 12,
  arenaHeight = 12,
  showDirection = false,
}) {
  return (
    <span
      className={`battle-bullet${showDirection ? ' debugger-bullet-direction' : ''}`}
      aria-hidden="true"
      style={{
        left: `${((x + 0.5) / arenaWidth) * 100}%`,
        top: `${((y + 0.5) / arenaHeight) * 100}%`,
        width: `${44 / arenaWidth}%`,
        height: `${18 / arenaHeight}%`,
        transform: `translate(-50%, -50%) rotate(${-rotation}deg)`,
      }}
    >
      {showDirection && (
        <>
          <span className="debugger-bullet-direction__arrow debugger-bullet-direction__arrow--top" />
          <span className="debugger-bullet-direction__arrow debugger-bullet-direction__arrow--bottom" />
        </>
      )}
    </span>
  );
}
