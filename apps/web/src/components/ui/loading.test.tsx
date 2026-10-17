// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContentLoading, ScreenLoading } from './loading';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));
it('suppresses fast loading feedback, cancels timers, and never holds ready content', () => {
  act(() => root.render(<ContentLoading layout="expenses" />));
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  tick(149);
  expect(host.textContent).toBe('');
  expect(host.querySelector('[data-ui="skeleton"]')).toBeNull();
  act(() => root.render(<p>Ready expense</p>));
  expect(host.textContent).toBe('Ready expense');
  expect(vi.getTimerCount()).toBe(0);
  tick(8_000);
  expect(host.textContent).toBe('Ready expense');
});
it.each(['overview', 'expenses', 'balances', 'activity', 'members'] as const)(
  'announces %s once, outside the busy decorative geometry, without moving focus',
  (layout) => {
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    act(() => root.render(<ContentLoading layout={layout} />));
    tick(150);
    const status = host.querySelector('[role="status"]')!;
    expect(status.textContent).toBe(`Loading ${layout}…`);
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(status.closest('[aria-busy]')).toBeNull();
    expect(
      host.querySelectorAll('[data-ui="skeleton"][aria-hidden="true"]').length,
    ).toBeGreaterThan(3);
    expect(host.querySelector('button, a, input')).toBeNull();
    expect(document.activeElement).toBe(button);
    tick(7_849);
    expect(status.textContent).toBe(`Loading ${layout}…`);
    tick(1);
    expect(status.textContent).toBe(`Still loading ${layout}…`);
    act(() => root.render(<p role="alert">Access unavailable</p>));
    expect(host.querySelector('[aria-busy]')).toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(document.activeElement).toBe(button);
    button.remove();
  },
);
it('uses only public startup copy, progresses to truthful slow feedback, and resets on a new visit', () => {
  act(() => root.render(<ScreenLoading />));
  expect(host.textContent).toBe('Kami Grow');
  tick(150);
  expect(host.textContent).toBe(
    'Kami GrowGetting things readyOpening your account…',
  );
  tick(7_850);
  expect(host.textContent).toBe(
    'Kami GrowStill getting things readyThis is taking a little longer.',
  );
  act(() => root.render(<p>Ready</p>));
  expect(host.textContent).toBe('Ready');
  act(() => root.render(<ScreenLoading />));
  expect(host.textContent).toBe('Kami Grow');
  tick(150);
  expect(host.textContent).not.toContain('Still');
});

it('background time does not count as a foreground slow wait', () => {
  act(() => root.render(<ScreenLoading />));
  tick(4000);
  act(() => window.dispatchEvent(new Event('pagehide')));
  tick(60000);
  expect(host.textContent).toBe('Kami Grow');
  act(() => window.dispatchEvent(new Event('pageshow')));
  tick(150);
  expect(host.textContent).toContain('Getting things ready');
  expect(host.textContent).not.toContain('Still');
  tick(7850);
  expect(host.textContent).toContain('Still getting things ready');
});
