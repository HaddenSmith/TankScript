import React from 'react';

export function BattleWall({ x, y, health, maxHealth, arenaWidth = 12, arenaHeight = 12 }) {
  if (health <= 0) return null;

  const healthRatio = health / maxHealth;
  let damage = 'intact';
  if (healthRatio <= 0.3) damage = 'heavy';
  else if (healthRatio <= 0.6) damage = 'moderate';
  else if (healthRatio < 1) damage = 'light';

  return (
    <div
      className={`battle-wall battle-wall--${damage}`}
      role="img"
      aria-label={`Wall, x ${x}, y ${y}, health ${health} of ${maxHealth}`}
      title={`Wall: ${health} / ${maxHealth} HP`}
      style={{
        left: `${((x + 0.5) / arenaWidth) * 100}%`,
        top: `${((y + 0.5) / arenaHeight) * 100}%`,
        width: `${90 / arenaWidth}%`,
        height: `${90 / arenaHeight}%`,
      }}
    >
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <path className="battle-wall__mortar" d="M0 13h40M0 27h40M20 0v13M10 13v14M30 13v14M20 27v13" />
        {damage !== 'intact' && (
          <path className="battle-wall__crack" d="m24 0-5 9 5 6-8 8 3 6" />
        )}
        {(damage === 'moderate' || damage === 'heavy') && (
          <path className="battle-wall__crack" d="m0 31 10-4 6-4m8-8 8 3 8-5" />
        )}
        {damage === 'heavy' && (
          <path className="battle-wall__crack" d="m19 29-4 5 2 6m15-22-4 9 5 6 7 1M10 27l-3-9-7-4" />
        )}
      </svg>
    </div>
  );
}
