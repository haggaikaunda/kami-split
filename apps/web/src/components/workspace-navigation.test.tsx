// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceNavigation } from './workspace-identity';

vi.mock('next/navigation', () => ({ usePathname: () => '/trips/summer' }));
afterEach(() => vi.restoreAllMocks());

it('reserves measured mobile chrome, follows keyboard resizing, and releases global offsets', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(640);
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
        height: this.classList.contains('workspace-navigation-brand')
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
    viewport.height = 360;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(main.style.getPropertyValue('--chrome-bottom')).toBe('280px');
    expect(
      document.documentElement.style.getPropertyValue('--chrome-footer'),
    ).toBe('420px');
    const input = document.createElement('input');
    main.append(input);
    act(() => input.focus());
    expect(main.style.getPropertyValue('--chrome-bottom')).toBe('344px');
    expect(main.style.getPropertyValue('--chrome-footer')).toBe('484px');
    viewport.height = 540;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(main.style.getPropertyValue('--chrome-bottom')).toBe('100px');
    viewport.height = 360;
    viewport.offsetTop = 30;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(main.style.getPropertyValue('--chrome-bottom')).toBe('314px');
    expect(main.style.getPropertyValue('--chrome-header')).toBe('70px');
    expect(
      document.documentElement.style.getPropertyValue('--chrome-header'),
    ).toBe('100px');
    viewport.offsetTop = 0;

    act(() => input.blur());
    expect(main.style.getPropertyValue('--chrome-bottom')).toBe('280px');
    viewport.offsetTop = 170;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(main.style.getPropertyValue('--chrome-top')).toBe('170px');
    // Panning must not add padding that cancels Safari's movement of the field.
    expect(main.style.getPropertyValue('--chrome-header')).toBe('70px');
    expect(
      document.documentElement.style.getPropertyValue('--chrome-header'),
    ).toBe('240px');
    expect(main.style.getPropertyValue('--chrome-bottom')).toBe('110px');
    viewport.offsetTop = 0;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    input.type = 'checkbox';
    act(() => input.focus());
    expect(main.style.getPropertyValue('--chrome-bottom')).toBe('280px');
    act(() => input.blur());
    input.type = 'text';
    act(() => input.focus());
    viewport.scale = 2;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(main.style.getPropertyValue('--chrome-bottom')).toBe('0px');
    expect(main.style.getPropertyValue('--chrome-footer')).toBe('140px');
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
