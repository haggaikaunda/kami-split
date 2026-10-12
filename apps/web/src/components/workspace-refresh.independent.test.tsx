// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceRefresh } from './workspace-refresh';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('CSS', { supports: () => true });
  vi.stubGlobal('scrollY', 0);
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
    'Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
  );
  host = document.createElement('main');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function touch(target: Element, type: string, x: number, y: number, count = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: Array.from({ length: count }, () => ({ clientX: x, clientY: y })),
  });
  act(() => target.dispatchEvent(event));
  return event;
}
function gesture(target: Element, distance = 100) {
  touch(target, 'touchstart', 20, 20);
  const move = touch(target, 'touchmove', 20, 20 + distance);
  touch(target, 'touchend', 20, 20 + distance, 0);
  return move;
}
it('coalesces repeated gestures and clicks, then allows retry after failure', () => {
  const refresh = vi.fn();
  act(() => root.render(<WorkspaceRefresh busy={false} onRefresh={refresh} />));
  expect(gesture(host).defaultPrevented).toBe(true);
  gesture(host);
  act(() => host.querySelector('button')!.click());
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => root.render(<WorkspaceRefresh busy onRefresh={refresh} />));
  expect(host.textContent).toContain('Updating');
  gesture(host);
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() =>
    root.render(
      <WorkspaceRefresh busy={false} error="Offline" onRefresh={refresh} />,
    ),
  );
  expect(host.textContent).toContain('Try again');
  act(() => host.querySelector('button')!.click());
  expect(refresh).toHaveBeenCalledTimes(2);
});
it('rejects below-top origins, horizontal drags, cancelled and multi-touch gestures', () => {
  const refresh = vi.fn();
  act(() => root.render(<WorkspaceRefresh busy={false} onRefresh={refresh} />));
  vi.stubGlobal('scrollY', 200);
  gesture(host);
  vi.stubGlobal('scrollY', 0);
  touch(host, 'touchstart', 0, 0);
  touch(host, 'touchmove', 150, 90);
  touch(host, 'touchend', 150, 90, 0);
  touch(host, 'touchstart', 0, 0);
  touch(host, 'touchmove', 0, 100);
  touch(host, 'touchcancel', 0, 100, 0);
  touch(host, 'touchend', 0, 100, 0);
  touch(host, 'touchstart', 0, 0);
  touch(host, 'touchmove', 0, 100, 2);
  touch(host, 'touchend', 0, 100, 0);
  expect(refresh).not.toHaveBeenCalled();
});
it('leaves editor and nested scroller gestures alone', () => {
  const refresh = vi.fn();
  act(() =>
    root.render(
      <>
        <WorkspaceRefresh busy={false} onRefresh={refresh} />
        <textarea />
        <section style={{ overflowY: 'auto' }}>
          <p>Nested</p>
        </section>
      </>,
    ),
  );
  expect(gesture(host.querySelector('textarea')!).defaultPrevented).toBe(false);
  const nested = host.querySelector('section')!;
  Object.defineProperties(nested, {
    scrollHeight: { value: 500 },
    clientHeight: { value: 100 },
  });
  expect(gesture(nested.querySelector('p')!).defaultPrevented).toBe(false);
  expect(refresh).not.toHaveBeenCalled();
});
it('keeps button fallback when browser cannot suppress native overscroll', () => {
  vi.stubGlobal('CSS', { supports: () => false });
  const refresh = vi.fn();
  act(() => root.render(<WorkspaceRefresh busy={false} onRefresh={refresh} />));
  expect(gesture(host).defaultPrevented).toBe(false);
  expect(refresh).not.toHaveBeenCalled();
  act(() => host.querySelector('button')!.click());
  expect(refresh).toHaveBeenCalledTimes(1);
});

it.each([
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
])(
  'retains native fallback on WebKit despite reported CSS support: %s',
  (userAgent) => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    const refresh = vi.fn();
    act(() =>
      root.render(<WorkspaceRefresh busy={false} onRefresh={refresh} />),
    );
    expect(gesture(host).defaultPrevented).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    act(() => host.querySelector('button')!.click());
    expect(refresh).toHaveBeenCalledTimes(1);
  },
);
