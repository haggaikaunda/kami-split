// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceNavigation } from './workspace-identity';

vi.mock('next/navigation', () => ({ usePathname: () => '/trips/summer' }));
afterEach(() => vi.restoreAllMocks());

it('measures chrome without repositioning it during viewport, focus or zoom changes', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
  const innerHeight = vi
    .spyOn(window, 'innerHeight', 'get')
    .mockReturnValue(640);
  const viewport = Object.assign(new EventTarget(), {
    scale: 1,
    offsetTop: 0,
    height: 640,
  });
  vi.stubGlobal('visualViewport', viewport);
  let resized: ResizeObserverCallback | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resized = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  let barHeight = 90;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return {
        height: this.getAttribute('data-ui')
          ?.split(/\s+/)
          .includes('workspace-navigation-brand')
          ? 70
          : barHeight,
      } as DOMRect;
    },
  );
  const main = document.createElement('main');
  document.body.append(main);
  const root = createRoot(main);
  try {
    act(() => root.render(<WorkspaceNavigation />));
    expect(main.style.getPropertyValue('--chrome-header')).toBe('70px');
    expect(main.style.getPropertyValue('--chrome-footer')).toBe('90px');
    expect(main.querySelector('[aria-current="page"]')?.textContent).toBe(
      'Trips',
    );
    barHeight = 140;
    act(() => resized?.([], {} as ResizeObserver));
    expect(main.style.getPropertyValue('--chrome-footer')).toBe('140px');
    const input = document.createElement('input');
    main.append(input);
    const assertMeasuredClearance = () => {
      expect(main.style.getPropertyValue('--chrome-header')).toBe('70px');
      expect(main.style.getPropertyValue('--chrome-footer')).toBe('140px');
      expect(
        document.documentElement.style.getPropertyValue('--chrome-header'),
      ).toBe('70px');
      expect(
        document.documentElement.style.getPropertyValue('--chrome-footer'),
      ).toBe('140px');
      for (const property of [
        '--chrome-top',
        '--chrome-bottom',
        '--chrome-nav-top',
        '--chrome-nav-bottom',
      ]) {
        expect(main.style.getPropertyValue(property)).toBe('');
      }
    };
    // Toolbar resize and overscroll/panning without any focused input.
    viewport.height = 360;
    viewport.offsetTop = 170;
    act(() => viewport.dispatchEvent(new Event('resize')));
    act(() => viewport.dispatchEvent(new Event('scroll')));
    assertMeasuredClearance();
    act(() => input.focus());
    innerHeight.mockReturnValue(371);
    viewport.height = 371;
    viewport.offsetTop = 90;
    act(() => window.dispatchEvent(new Event('resize')));
    assertMeasuredClearance();
    viewport.scale = 2;
    act(() => viewport.dispatchEvent(new Event('resize')));
    assertMeasuredClearance();
    act(() => input.blur());
    viewport.scale = 1;
    viewport.offsetTop = 0;
    viewport.height = 640;
    act(() => viewport.dispatchEvent(new Event('resize')));
    assertMeasuredClearance();
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(main.style.getPropertyValue('--chrome-footer')).toBe('0px');
  } finally {
    act(() => root.unmount());
    main.remove();
    vi.unstubAllGlobals();
  }
  expect(disconnect).toHaveBeenCalledOnce();
  expect(
    document.documentElement.style.getPropertyValue('--chrome-footer'),
  ).toBe('');
});
