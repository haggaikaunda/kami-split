// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceRefresh } from './workspace-refresh';
let host: HTMLElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('navigator', {
    userAgent: 'AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
  });
  vi.stubGlobal('CSS', { supports: () => true });
  vi.stubGlobal('scrollY', 0);
  host = document.createElement('main');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function touch(
  type: string,
  x: number,
  y: number,
  target: Element = host,
  count = 1,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: Array.from({ length: count }, () => ({ clientX: x, clientY: y })),
  });
  act(() => target.dispatchEvent(event));
  return event;
}
function pull(start = 0, end = 100) {
  touch('touchstart', 20, start);
  const move = touch('touchmove', 20, end);
  touch('touchend', 20, end, host, 0);
  return move;
}
it('coalesces gestures, reports pending/success/failure, and permits retry without moving focus', () => {
  const refresh = vi.fn();
  const render = (busy: boolean, error = '') =>
    act(() =>
      root.render(
        <WorkspaceRefresh busy={busy} error={error} onRefresh={refresh} />,
      ),
    );
  render(false);
  expect(host.querySelector('button')).toBeNull();
  host.tabIndex = -1;
  host.focus();
  pull();
  pull();
  pull();
  expect(refresh).toHaveBeenCalledTimes(1);
  render(true);
  expect(host.textContent).toContain('Updating');
  expect(document.activeElement).toBe(host);
  render(false);
  expect(host.textContent).toContain('Up to date');
  pull();
  render(true);
  render(false, 'offline');
  expect(host.textContent).toContain('Couldn’t refresh');
  pull();
  expect(refresh).toHaveBeenCalledTimes(3);
});
it('only claims deliberate single-touch downward pulls that began at the document top', () => {
  const refresh = vi.fn();
  act(() => root.render(<WorkspaceRefresh busy={false} onRefresh={refresh} />));
  vi.stubGlobal('scrollY', 80);
  touch('touchstart', 0, 0);
  vi.stubGlobal('scrollY', 0);
  touch('touchmove', 0, 100);
  touch('touchend', 0, 100);
  expect(refresh).not.toHaveBeenCalled();
  pull(0, 40);
  touch('touchstart', 0, 0);
  touch('touchmove', 100, 20);
  touch('touchend', 100, 20);
  touch('touchstart', 0, 0);
  touch('touchmove', 0, 100, host, 2);
  touch('touchend', 0, 100);
  const button = document.createElement('button');
  host.append(button);
  touch('touchstart', 0, 0, button);
  touch('touchmove', 0, 100);
  touch('touchend', 0, 100);
  expect(refresh).not.toHaveBeenCalled();
  expect(pull().defaultPrevented).toBe(true);
  expect(refresh).toHaveBeenCalledTimes(1);
});
it('leaves native gestures alone when overscroll suppression is unavailable and permits browser reload', () => {
  vi.stubGlobal('CSS', { supports: () => false });
  const refresh = vi.fn();
  act(() => root.render(<WorkspaceRefresh busy={false} onRefresh={refresh} />));
  expect(pull().defaultPrevented).toBe(false);
  expect(refresh).not.toHaveBeenCalled();
  expect(
    document.documentElement.classList.contains('workspace-pull-refresh'),
  ).toBe(false);
  expect(host.querySelector('button')).toBeNull();
});
it('does not refresh on canceled gestures or while a request is pending, and releases overscroll ownership on unmount', () => {
  const refresh = vi.fn();
  act(() => root.render(<WorkspaceRefresh busy onRefresh={refresh} />));
  pull();
  expect(refresh).not.toHaveBeenCalled();
  act(() => root.render(<WorkspaceRefresh busy={false} onRefresh={refresh} />));
  touch('touchstart', 0, 0);
  touch('touchmove', 0, 100);
  touch('touchcancel', 0, 100);
  touch('touchend', 0, 100);
  expect(refresh).not.toHaveBeenCalled();
  act(() => root.render(null));
  expect(
    document.documentElement.classList.contains('workspace-pull-refresh'),
  ).toBe(false);
  pull();
  expect(refresh).not.toHaveBeenCalled();
});

it('reports completion for owning-reader automatic refreshes without a button or gesture', () => {
  const refresh = vi.fn();
  const render = (busy: boolean) =>
    act(() =>
      root.render(<WorkspaceRefresh busy={busy} onRefresh={refresh} />),
    );
  render(false);
  expect(host.textContent).toBe('');
  render(true);
  expect(host.textContent).toContain('Updating');
  render(false);
  expect(host.textContent).toContain('Up to date');
  expect(refresh).not.toHaveBeenCalled();
  expect(host.querySelector('button')).toBeNull();
});
