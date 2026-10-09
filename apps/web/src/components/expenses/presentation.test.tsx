// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { ExpensePresentation } from './presentation';
let host: HTMLDivElement, root: Root, trigger: HTMLButtonElement;
let resize: () => void;
const media = {
  matches: false,
  addEventListener: vi.fn((_name: string, callback: () => void) => {
    resize = callback;
  }),
  removeEventListener: vi.fn(),
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia = vi.fn().mockReturnValue(media);
  media.matches = false;
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  host = document.createElement('div');
  trigger = document.createElement('button');
  document.body.append(trigger, host);
  trigger.focus();
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  trigger.remove();
});
it('dismisses only a gesture beginning and ending on the viewport backdrop, and restores focus/scroll lock', async () => {
  const close = vi.fn();
  await act(async () =>
    root.render(
      <ExpensePresentation title="Expense detail" onClose={close}>
        <button>Inside</button>
      </ExpensePresentation>,
    ),
  );
  const dialog = host.querySelector('dialog')!;
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
    left: 600,
    right: 1000,
    top: 0,
    bottom: 800,
  } as DOMRect);
  expect(document.activeElement).toBe(host.querySelector('h1'));
  expect(document.body.style.overflow).toBe('hidden');
  const pointer = (target: Element, type: string, x: number) =>
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, clientX: x, clientY: 40 }),
    );
  await act(async () => {
    pointer(dialog, 'pointerdown', 650);
    pointer(dialog, 'click', 650);
  });
  expect(close).not.toHaveBeenCalled();
  await act(async () => {
    pointer(dialog, 'pointerdown', 650);
    pointer(dialog, 'click', 40);
  });
  expect(close).not.toHaveBeenCalled();
  await act(async () => {
    pointer(dialog, 'pointerdown', 40);
    pointer(dialog, 'click', 40);
  });
  expect(close).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  expect(document.activeElement).toBe(trigger);
  expect(document.body.style.overflow).toBe('');
});
it('keeps the mounted draft while resizing between desktop dialog and mobile screen', async () => {
  function Draft() {
    const [value, setValue] = useState('Saved');
    return <button onClick={() => setValue('Draft retained')}>{value}</button>;
  }
  await act(async () =>
    root.render(
      <ExpensePresentation title="Expense detail" onClose={vi.fn()}>
        <Draft />
      </ExpensePresentation>,
    ),
  );
  await act(async () =>
    Array.from(host.querySelectorAll('button'))
      .find((b) => b.textContent === 'Saved')!
      .click(),
  );
  await act(async () => {
    media.matches = true;
    resize();
  });
  expect(host.querySelector('dialog')?.getAttribute('role')).toBe('region');
  expect(host.textContent).toContain('Draft retained');
  await act(async () => {
    media.matches = false;
    resize();
  });
  expect(host.querySelector('dialog')?.getAttribute('role')).toBe('dialog');
  expect(host.textContent).toContain('Draft retained');
});

it('keeps creation modal across phone resize and preserves its mounted draft and dismissal', async () => {
  const close = vi.fn();
  await act(async () =>
    root.render(
      <ExpensePresentation title="Add expense" kind="create" onClose={close}>
        <input aria-label="Description" defaultValue="Unsubmitted draft" />
      </ExpensePresentation>,
    ),
  );
  const input = host.querySelector('input')!;
  await act(async () => {
    media.matches = true;
    resize();
  });
  expect(host.querySelector('dialog')?.getAttribute('role')).toBe('dialog');
  expect(host.querySelector('dialog')?.getAttribute('aria-modal')).toBe('true');
  expect(host.querySelector('input')).toBe(input);
  expect(input.value).toBe('Unsubmitted draft');
  await act(async () =>
    host
      .querySelector('dialog')!
      .dispatchEvent(new Event('cancel', { cancelable: true })),
  );
  expect(close).toHaveBeenCalledOnce();
});
