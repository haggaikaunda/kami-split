// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { RichHelp, BalanceExplanation } from './rich-help';
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return (
        this.classList.contains('rich-help-panel')
          ? {
              width: 300,
              height: 180,
              left: 0,
              top: 0,
              right: 300,
              bottom: 180,
            }
          : {
              width: 110,
              height: 30,
              left: 300,
              right: 410,
              top: 400,
              bottom: 430,
            }
      ) as DOMRect;
    },
  );
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 440,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 600,
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const click = (button: Element) =>
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
it('opens one optional anchored help at a time, stays in the viewport above a low trigger and dismisses with focus restored', () => {
  act(() =>
    root.render(
      <>
        <RichHelp label="Your balance">Balance definition</RichHelp>
        <RichHelp label="Your share">Share definition</RichHelp>
      </>,
    ),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const [balance, share] = [...host.querySelectorAll('button')];
  click(balance);
  const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(panel.style.left).toBe('132px');
  expect(panel.style.top).toBe('212px');
  expect(panel.textContent).toContain('Balance definition');
  expect(balance.getAttribute('aria-expanded')).toBe('true');
  click(share);
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'Share definition',
  );
  expect(balance.getAttribute('aria-expanded')).toBe('false');
  act(() =>
    share.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(document.activeElement?.textContent).toBe('Got it');
  act(() =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(document.activeElement).toBe(share);

  act(() =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(share);
  click(balance);
  click(document.querySelector('[role="dialog"] button')!);
  expect(document.activeElement).toBe(balance);
});
it('dismisses on outside pointer or focus, retains interaction inside, and hides explanations until requested', () => {
  act(() =>
    root.render(
      <>
        <RichHelp label="What’s included">Scope definition</RichHelp>
        <button>Outside</button>
        <BalanceExplanation household />
      </>,
    ),
  );
  const trigger = host.querySelector('button')!;
  click(trigger);
  act(() =>
    document
      .querySelector('[role="dialog"]')!
      .dispatchEvent(new Event('pointerdown', { bubbles: true })),
  );
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  act(() =>
    host.lastElementChild!.dispatchEvent(
      new Event('pointerdown', { bubbles: true }),
    ),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  click(trigger);
  act(() => host.querySelectorAll('button')[1].focus());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect([...host.querySelectorAll('details')].every((d) => !d.open)).toBe(
    true,
  );
  expect(
    [...host.querySelectorAll('summary')].map((s) => s.textContent),
  ).toEqual([
    'How your balance works',
    'See an example',
    'Why can my total be $0?',
  ]);
});

it('keeps help scrollable within a short enlarged-text viewport when neither side fits its natural height', () => {
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 250,
  });
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(
    function (this: HTMLElement) {
      return (
        this.classList.contains('rich-help-panel')
          ? {
              width: 300,
              height: 360,
              left: 0,
              top: 0,
              right: 300,
              bottom: 360,
            }
          : {
              width: 110,
              height: 30,
              left: 0,
              right: 110,
              top: 100,
              bottom: 130,
            }
      ) as DOMRect;
    },
  );
  act(() =>
    root.render(<RichHelp label="Your balance">Long explanation</RichHelp>),
  );
  click(host.querySelector('button')!);
  const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(panel.style.top).toBe('138px');
  expect(panel.style.maxHeight).toBe('104px');
  expect(panel.style.left).toBe('8px');
});
