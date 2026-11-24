/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, jest, test } from '@jest/globals';
import { BattleArena } from '../../../frontend/src/battle/components/BattleArena.jsx';
import { createBattleFromSelectedTanks } from '../../../frontend/src/game/battleController.js';
import { createBattleStateSnapshot } from '../../../frontend/src/game/battleState.js';
import { Wall } from '../../../frontend/src/game/engine/wall.js';
import { Bullet } from '../../../frontend/src/game/engine/bullet.js';

describe('battle wall integration', () => {
  const participants = Array.from({ length: 12 }, (_, id) => ({ id, name: `Tank ${id}`, code: '' }));

  test('keeps walls disabled by default and when explicitly disabled', () => {
    const random = jest.spyOn(Math, 'random');
    try {
      expect(createBattleFromSelectedTanks(participants, 20).arena.walls).toEqual([]);
      expect(createBattleFromSelectedTanks(participants, 20, 3, false).arena.walls).toEqual([]);
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });

  test.each([8, 12, 20])('generates default-health walls after placing tanks in a %s-cell arena', size => {
    const engine = createBattleFromSelectedTanks(participants.slice(0, size === 8 ? 6 : 12), size, 3, true);
    expect(engine.arena.walls.length).toBeGreaterThan(0);
    for (const wall of engine.arena.walls) {
      expect(wall.health).toBe(10);
      expect(engine.arena.isPositionOccupiedByTank(wall.x, wall.y)).toBe(false);
      expect(engine.arena.isTankOutOfBounds(wall)).toBe(false);
    }
  });

  test('renders snapshot coordinates and damage, then removes a destroyed wall without removing engine data', () => {
    const engine = createBattleFromSelectedTanks(participants.slice(0, 2), 8);
    const wall = new Wall(2, 3);
    engine.arena.addWall(wall);
    const snapshot = () => createBattleStateSnapshot(engine, 3);
    const { rerender } = render(<BattleArena {...snapshot().arena} />);
    expect(screen.getByRole('img', { name: /Wall, x 2, y 3, health 10 of 10/ }))
      .toHaveStyle({ left: '31.25%', top: '43.75%', width: '11.25%', height: '11.25%' });
    expect(document.querySelector('.battle-wall')).toHaveClass('battle-wall--intact');
    for (let hit = 1; hit <= 10; hit++) {
      engine.arena.addBullet(new Bullet(hit, 99, 1.5, 3, 0));
      engine.resolveTick({});
      rerender(<BattleArena {...snapshot().arena} />);
      if (hit === 1) expect(document.querySelector('.battle-wall')).toHaveClass('battle-wall--light');
      if (hit === 4) expect(document.querySelector('.battle-wall')).toHaveClass('battle-wall--moderate');
      if (hit === 7) expect(document.querySelector('.battle-wall')).toHaveClass('battle-wall--heavy');
    }
    expect(document.querySelector('.battle-wall')).toBeNull();
    expect(engine.arena.walls).toEqual([wall]);
    expect(snapshot().arena.walls).toEqual([]);
  });

  test('uses original maximum health for custom walls and never draws zero-health walls', () => {
    render(<BattleArena walls={[{ x: 1, y: 2, health: 1, maxHealth: 2 }, { x: 3, y: 4, health: 0, maxHealth: 10 }]} />);
    expect(screen.getAllByRole('img', { name: /Wall/ })).toHaveLength(1);
    expect(document.querySelector('.battle-wall')).toHaveClass('battle-wall--moderate');
  });
});
