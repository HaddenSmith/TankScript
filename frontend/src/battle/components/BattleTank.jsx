import React from 'react';
import { DEFAULT_TANK_COLOR, TANK_COLORS } from '../../../../shared/game/tankColors.js';

export function BattleTank({
  x,
  y,
  rotation = 0,
  health,
  startingHealth = 3,
  name,
  id,
  arenaWidth = 12,
  arenaHeight = 12,
  color = DEFAULT_TANK_COLOR,
}) {
  const tankName = name ?? (id !== undefined ? `Tank ${id}` : 'Tank');
  const positionLabel = `x ${x}, y ${y}`;
  const healthLabel = health !== undefined ? `, health ${health}` : '';
  const tankColor = TANK_COLORS.find((item) => item.value === color);

  return (
    <div
      className="battle-tank"
      role="img"
      aria-label={`${tankName}, ${positionLabel}${healthLabel}`}
      style={{
        '--tank-color': color,
        '--tank-border-color': tankColor?.border ?? '#c7e6e6',
        left: `${((x + 0.5) / arenaWidth) * 100}%`,
        top: `${((y + 0.5) / arenaHeight) * 100}%`,
        width: `${72 / arenaWidth}%`,
        height: `${72 / arenaHeight}%`,
        transform: `translate(-50%, -50%) rotate(${-rotation}deg)`,
      }}
    >
      <span className="battle-tank__visual" aria-hidden="true">
        <span className="battle-tank__turret" />
      </span>
      {startingHealth > 1 && health !== undefined && (
        <span className="battle-tank__health" aria-hidden="true">{health}</span>
      )}
    </div>
  );
}
