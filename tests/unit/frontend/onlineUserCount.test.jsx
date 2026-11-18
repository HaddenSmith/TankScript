/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://tankscript.test/battle"}
 */
import React, { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { OnlineUserCount } from '../../../frontend/src/components/OnlineUserCount.jsx';

describe('online connection count', () => {
  let sockets;

  beforeEach(() => {
    jest.useFakeTimers();
    sockets = [];
    jest.spyOn(window, 'WebSocket').mockImplementation(() => {
      const socket = { close: jest.fn() };
      sockets.push(socket);
      return socket;
    });
  });

  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('connects to the same host using secure WebSockets and shows an initial status', () => {
    render(<OnlineUserCount />);

    expect(WebSocket).toHaveBeenCalledWith('wss://tankscript.test/ws');
    expect(screen.getByRole('status', { name: 'Online connections' })).toHaveTextContent('Connecting…');
    expect(screen.getByRole('status')).not.toHaveClass('online-user-count--connected');
  });

  test('shows the connection indicator and updates live counts including zero', () => {
    render(<OnlineUserCount />);
    act(() => sockets[0].onopen());
    expect(screen.getByRole('status')).toHaveTextContent('Connected');
    expect(screen.getByRole('status')).toHaveClass('online-user-count--connected');

    for (const count of [3, 12, 0]) {
      act(() => sockets[0].onmessage({ data: JSON.stringify({ type: 'online-count', count }) }));
      expect(screen.getByRole('status')).toHaveTextContent(`${count} online`);
    }
  });

  test('ignores malformed messages, other message types, and invalid counts', () => {
    render(<OnlineUserCount />);
    act(() => {
      sockets[0].onopen();
      sockets[0].onmessage({ data: '{"type":"online-count","count":3}' });
    });
    for (const data of [
      '{', 'null', '[]', '{}',
      '{"type":"chat","count":8}',
      ...[-1, 1.5, '4', null, true, Number.MAX_SAFE_INTEGER + 1]
        .map(count => JSON.stringify({ type: 'online-count', count })),
    ]) {
      act(() => sockets[0].onmessage({ data }));
      expect(screen.getByRole('status')).toHaveTextContent('3 online');
    }
  });

  test('clears a stale count on disconnect and receives a fresh count after reconnecting', () => {
    render(<OnlineUserCount />);
    act(() => {
      sockets[0].onopen();
      sockets[0].onmessage({ data: '{"type":"online-count","count":3}' });
      sockets[0].onclose();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Disconnected');
    expect(screen.getByRole('status')).not.toHaveTextContent('3 online');
    expect(screen.getByRole('status')).not.toHaveClass('online-user-count--connected');
    act(() => jest.advanceTimersByTime(999));
    expect(WebSocket).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(1));
    expect(WebSocket).toHaveBeenCalledTimes(2);
    act(() => {
      sockets[1].onopen();
      sockets[1].onmessage({ data: '{"type":"online-count","count":2}' });
    });
    expect(screen.getByRole('status')).toHaveTextContent('2 online');
  });

  test('stops after three unsuccessful reconnects with delays of one, two, and four seconds', () => {
    render(<OnlineUserCount />);
    for (const [index, delay] of [1000, 2000, 4000].entries()) {
      act(() => sockets[index].onerror());
      expect(sockets[index].close).toHaveBeenCalledTimes(1);
      expect(sockets[index].onclose).toBeNull();
      act(() => jest.advanceTimersByTime(delay - 1));
      expect(WebSocket).toHaveBeenCalledTimes(index + 1);
      act(() => jest.advanceTimersByTime(1));
      expect(WebSocket).toHaveBeenCalledTimes(index + 2);
    }
    act(() => {
      sockets[3].onclose();
      jest.advanceTimersByTime(60_000);
    });
    expect(WebSocket).toHaveBeenCalledTimes(4);
    expect(screen.getByRole('status')).toHaveTextContent('Disconnected');
    expect(jest.getTimerCount()).toBe(0);
  });

  test('resets the retry budget after a successful connection', () => {
    render(<OnlineUserCount />);
    act(() => {
      sockets[0].onclose();
      jest.advanceTimersByTime(1000);
      sockets[1].onopen();
      sockets[1].onclose();
      jest.advanceTimersByTime(1000);
    });
    expect(WebSocket).toHaveBeenCalledTimes(3);
  });

  test('handles a connection constructor failure with the same bounded retry strategy', () => {
    WebSocket.mockImplementation(() => { throw new Error('Connection unavailable'); });
    render(<OnlineUserCount />);
    expect(screen.getByRole('status')).toHaveTextContent('Disconnected');
    act(() => jest.advanceTimersByTime(60_000));
    expect(WebSocket).toHaveBeenCalledTimes(4);
    expect(jest.getTimerCount()).toBe(0);
  });

  test.each([false, true])('closes the socket and removes handlers on unmount when connected is %s', (connected) => {
    const view = render(<OnlineUserCount />);
    if (connected) act(() => sockets[0].onopen());
    view.unmount();
    expect(sockets[0].close).toHaveBeenCalledTimes(1);
    for (const handler of ['onopen', 'onmessage', 'onclose', 'onerror']) expect(sockets[0][handler]).toBeNull();
    act(() => jest.advanceTimersByTime(60_000));
    expect(WebSocket).toHaveBeenCalledTimes(1);
  });

  test('cancels a scheduled reconnect on unmount', () => {
    const view = render(<OnlineUserCount />);
    act(() => sockets[0].onclose());
    view.unmount();
    act(() => jest.advanceTimersByTime(60_000));
    expect(WebSocket).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('closes the first Strict Mode connection before mounting again', () => {
    const view = render(<StrictMode><OnlineUserCount /></StrictMode>);
    expect(sockets).toHaveLength(2);
    expect(sockets[0].close).toHaveBeenCalledTimes(1);
    act(() => {
      sockets[1].onopen();
      sockets[1].onmessage({ data: '{"type":"online-count","count":1}' });
    });
    expect(screen.getByRole('status')).toHaveTextContent('1 online');
    view.unmount();
    expect(sockets[1].close).toHaveBeenCalledTimes(1);
  });
});
