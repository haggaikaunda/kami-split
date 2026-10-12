// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RichHelp } from './rich-help';

it.each([-100, 700])(
  'keeps help within the viewport or dismisses it when scrolling its trigger to %s',
  (offscreenTop) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let triggerTop = 100;
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return (
          this.classList.contains('rich-help-panel')
            ? {
                width: 300,
                height: 180,
                left: 8,
                right: 308,
                top: 8,
                bottom: 188,
              }
            : {
                width: 110,
                height: 30,
                left: 20,
                right: 130,
                top: triggerTop,
                bottom: triggerTop + 30,
              }
        ) as DOMRect;
      });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 390,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 600,
    });
    try {
      act(() =>
        root.render(
          <RichHelp label="Your balance">Optional definition</RichHelp>,
        ),
      );
      act(() => host.querySelector('button')!.click());
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      triggerTop = offscreenTop;
      act(() => window.dispatchEvent(new Event('scroll')));
      const panel = document.querySelector<HTMLElement>('[role="dialog"]');
      if (panel) {
        expect(Number.parseFloat(panel.style.top)).toBeGreaterThanOrEqual(8);
        expect(Number.parseFloat(panel.style.top) + 180).toBeLessThanOrEqual(
          592,
        );
      }
    } finally {
      act(() => root.unmount());
      host.remove();
      rect.mockRestore();
    }
  },
);
