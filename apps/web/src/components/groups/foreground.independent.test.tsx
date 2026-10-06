// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useForegroundRefresh } from './foreground';
afterEach(() => vi.unstubAllGlobals());
it('invalidates synchronously for each foreground event but reads once after the burst, and cancels on unmount', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const invalidate = vi.fn(),
    refresh = vi.fn();
  function Probe() {
    useForegroundRefresh(invalidate, refresh);
    return null;
  }
  const host = document.createElement('div'),
    root = createRoot(host);
  act(() => root.render(<Probe />));
  act(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
  });
  expect(invalidate).toHaveBeenCalledTimes(3);
  expect(refresh).not.toHaveBeenCalled();
  expect(frames.size).toBe(1);
  act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((cb) => cb(0));
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(frames.size).toBe(1);
  act(() => root.unmount());
  expect(frames.size).toBe(0);
  window.dispatchEvent(new Event('focus'));
  expect(invalidate).toHaveBeenCalledTimes(4);
});
