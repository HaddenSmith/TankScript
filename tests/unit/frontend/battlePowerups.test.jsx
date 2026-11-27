/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from '@jest/globals';
import { BattleArena } from '../../../frontend/src/battle/components/BattleArena.jsx';
import { createBattleFromSelectedTanks } from '../../../frontend/src/game/battleController.js';
import { createBattleEventsFromSnapshots, createBattleStateSnapshot } from '../../../frontend/src/game/battleState.js';
import { Heart } from '../../../frontend/src/game/engine/heart.js';
import { Lightning } from '../../../frontend/src/game/engine/lightning.js';

const participants = [{ id: 'a', name: 'Collector', code: '' }, { id: 'b', name: 'Other', code: '' }];

describe('power-ups in trusted rendering snapshots', () => {
  test.each([[false, false], [true, false], [false, true], [true, true]])(
    'configures walls (%s) and power-ups (%s) independently', (walls, powerups) => {
      const engine = createBattleFromSelectedTanks(participants, 12, 3, walls, powerups);
      expect(engine.powerupsEnabled).toBe(powerups);
      expect(engine.arena.walls.length > 0).toBe(walls);
      expect(engine.arena.hearts).toEqual([]);
      expect(engine.arena.lightnings).toEqual([]);
      engine.resolveTick({});
      expect(engine.arena.hearts.length).toBe(powerups ? 1 : 0);
      expect(engine.arena.lightnings.length).toBe(powerups ? 1 : 0);
    },
  );

  test('defaults to disabled and renders both pickup types at their grid coordinates', () => {
    expect(createBattleFromSelectedTanks(participants, 8).powerupsEnabled).toBe(false);
    render(<BattleArena width={8} height={8} hearts={[{ x: 2, y: 3 }]} lightnings={[{ x: 4, y: 5 }]} />);
    expect(screen.getByRole('img', { name: 'Heart, x 2, y 3' })).toHaveStyle({ left: '31.25%', top: '43.75%', width: '7.5%' });
    expect(screen.getByRole('img', { name: 'Lightning, x 4, y 5' })).toHaveStyle({ left: '56.25%', top: '68.75%' });
    expect(screen.queryByText('Arena state is not available.')).not.toBeInTheDocument();
    expect(document.querySelector('.powerup-icon--heart')).toBeInTheDocument();
    expect(document.querySelector('.powerup-icon--lightning')).toBeInTheDocument();
  });

  test('reflects real collection, capped healing and lightning without sharing mutable engine objects', () => {
    const engine = createBattleFromSelectedTanks(participants, 12, 3, false, true);
    const tank = engine.arena.tanks[0];
    tank.takeDamage();
    engine.arena.addHeart(new Heart(2, 6));
    engine.arena.addLightning(new Lightning(3, 6));
    const before = createBattleStateSnapshot(engine, 3);
    const { rerender } = render(<BattleArena {...before.arena} />);
    engine.resolveTick({ 1: 'moveRight' });
    const healed = createBattleStateSnapshot(engine, 3);
    rerender(<BattleArena {...healed.arena} />);
    expect(screen.queryByRole('img', { name: /Heart, x/ })).toBeNull();
    expect(screen.getByRole('img', { name: 'Collector, x 2, y 6, health 3' })).toBeInTheDocument();
    expect(healed.arena.tanks[0]).toMatchObject({ health: 3, maxHealth: 3, hasLightningPowerup: false });
    expect(before.arena.hearts).toEqual([{ x: 2, y: 6 }]);
    expect(before.arena.tanks[0].health).toBe(2);
    expect(createBattleEventsFromSnapshots(before, healed)).toContain('Collector healed (2 -> 3 health).');

    engine.resolveTick({ 1: 'moveRight' });
    const upgraded = createBattleStateSnapshot(engine, 3);
    rerender(<BattleArena {...upgraded.arena} />);
    expect(screen.queryByRole('img', { name: /Lightning, x/ })).toBeNull();
    expect(screen.getByRole('img', { name: /Collector,.*lightning upgrade/ })).toBeInTheDocument();
    expect(document.querySelector('.battle-tank__lightning')).toBeInTheDocument();
    expect(upgraded.arena.tanks[0].lightningTicksRemaining).toBe(50);
    expect(createBattleEventsFromSnapshots(healed, upgraded)).toContain('Collector collected lightning. Future bullets travel twice as fast for the next 50 ticks.');
    expect(engine.getTankScriptStates()[0]).not.toHaveProperty('hearts');
    expect(engine.getTankScriptStates()[0].allTanks[0]).not.toHaveProperty('hasLightningPowerup');
  });
});
