/** @jest-environment jsdom */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from '@jest/globals';
import { TankScriptReference } from '../../../frontend/src/tank-editor/components/TankScriptReference.jsx';

describe('TankScript API reference', () => {
  test.each(['javascript', 'typescript', 'python'])('groups %s state with descriptions beneath property names', language => {
    const { container } = render(<TankScriptReference language={language} />);
    const state = screen.getByRole('region', { name: 'Read-only state' });
    for (const name of ['Tank state', 'Arena objects', 'Arena dimensions']) {
      expect(within(state).getByRole('heading', { name })).toBeInTheDocument();
    }
    const python = language === 'python';
    for (const name of python
      ? ['all_walls', 'all_powerups', 'tank_max_health', 'tank_bullet_speed', 'tank_lightning_ticks_remaining']
      : ['allWalls', 'allPowerups', 'tankMaxHealth', 'tankBulletSpeed', 'tankLightningTicksRemaining']) {
      const term = within(state).getByText(name).closest('dt');
      expect(term.nextElementSibling.tagName).toBe('DD');
      expect(term.nextElementSibling.textContent.length).toBeGreaterThan(10);
      expect(term.parentElement.parentElement.tagName).toBe('DL');
    }
    expect(state).toHaveClass('tank-reference-state');
    expect(state).toHaveTextContent('N+1 through N+30');
    expect(state).toHaveTextContent('replenished every 75 game ticks');
    expect(state).toHaveTextContent('Existing bullets keep their fired speed');
    expect(container.querySelector('pre code')).toHaveTextContent(python ? 'all_powerups' : 'allPowerups');
    expect(screen.getByText(/Generate Command remains static/)).toBeInTheDocument();
  });

  test('documents the experimental Java limitation without offering unavailable fields', () => {
    render(<TankScriptReference language="java" />);
    expect(screen.getByText(/Experimental Java retains the older snapshot API/)).toBeInTheDocument();
    expect(screen.queryByText('state.allWalls()')).not.toBeInTheDocument();
    expect(screen.getByText('state.allTanks()')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Actions' })).getByText('api.shoot()')).toBeInTheDocument();
  });
});
