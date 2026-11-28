/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, test } from '@jest/globals';
import { About } from '../../../frontend/src/about/about.jsx';

test('describes the public game, static Debugger and project history accurately', () => {
  const { container } = render(<About />);
  expect(screen.getByRole('heading', { name: 'About TankScript' })).toBeInTheDocument();
  for (const text of ['JavaScript, TypeScript, or Python', 'static scenario', 'acts simultaneously',
    'destructible walls', '50 game ticks', 'shared by the community', 'BYU CS 260', 'personal hobby project']) {
    expect(container).toHaveTextContent(text);
  }
  expect(container.textContent).not.toMatch(/ranked matchmaking|global leaderboard|Java execution/);
  expect(screen.getByRole('link', { name: 'CueName' })).toHaveAttribute('href', 'https://cuename.com/');
});
