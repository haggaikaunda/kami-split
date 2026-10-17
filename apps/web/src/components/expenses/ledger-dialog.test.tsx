// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LedgerDialog } from './ledger';
import { ExpensePresentation } from './presentation';

it('keeps one draft in the keyboard viewport, ignores pinch zoom and restores its trigger on dismissal', async () => {
  const viewport = Object.assign(new EventTarget(), {
    height: 800,
    offsetTop: 0,
    scale: 1,
  });
  const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: viewport,
  });
  const remove = vi.spyOn(viewport, 'removeEventListener');
  const trigger = document.createElement('button');
  const host = document.createElement('div');
  document.body.append(trigger, host);
  trigger.focus();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const root = createRoot(host);
  const close = vi.fn();
  try {
    await act(async () =>
      root.render(
        <LedgerDialog title="Expense filters" onClose={close}>
          <input defaultValue="Unapplied draft" />
        </LedgerDialog>,
      ),
    );
    const dialog = host.querySelector('dialog')!;
    const draft = host.querySelector('input');
    expect(document.body.style.overflow).toBe('hidden');
    expect(dialog.style.getPropertyValue('--filter-viewport-height')).toBe(
      '800px',
    );
    Object.assign(viewport, { height: 320, offsetTop: 40 });
    viewport.dispatchEvent(new Event('resize'));
    expect(dialog.style.getPropertyValue('--filter-viewport-height')).toBe(
      '320px',
    );
    expect(dialog.style.getPropertyValue('--filter-viewport-top')).toBe('40px');
    Object.assign(viewport, { height: 160, scale: 2 });
    viewport.dispatchEvent(new Event('resize'));
    expect(dialog.style.getPropertyValue('--filter-viewport-height')).toBe(
      '320px',
    );
    expect(host.querySelector('input')).toBe(draft);
    expect(draft?.value).toBe('Unapplied draft');
    await act(async () =>
      dialog.dispatchEvent(new Event('cancel', { cancelable: true })),
    );
    expect(close).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
    expect(remove.mock.calls.map(([event]) => event)).toEqual([
      'resize',
      'scroll',
    ]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    trigger.remove();
    if (original) Object.defineProperty(window, 'visualViewport', original);
    else Reflect.deleteProperty(window, 'visualViewport');
  }
});

for (const kind of ['detail', 'create'] as const) {
  it.each(['dispose together', 'filters first', 'expense first'])(
    `releases overlapping filters/${kind} scroll ownership after %s without losing the retained draft`,
    async (order) => {
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
      window.matchMedia = vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
      };
      HTMLDialogElement.prototype.close = function () {
        this.open = false;
      };
      const previous = document.body.style.getPropertyValue('overflow');
      const priority = document.body.style.getPropertyPriority('overflow');
      document.body.style.setProperty('overflow', 'scroll', 'important');
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      const render = async (filters: boolean, expense: boolean) =>
        act(async () =>
          root.render(
            <StrictMode>
              {filters && (
                <LedgerDialog title="Expense filters" onClose={vi.fn()}>
                  <input defaultValue="Unapplied filter draft" />
                </LedgerDialog>
              )}
              {expense && (
                <ExpensePresentation
                  title="Expense"
                  kind={kind}
                  onClose={vi.fn()}
                >
                  <button>Expense action</button>
                </ExpensePresentation>
              )}
            </StrictMode>,
          ),
        );
      try {
        await render(true, false);
        const draft = host.querySelector('input');
        await render(true, true);
        expect(host.querySelectorAll('dialog[open]')).toHaveLength(2);
        expect(host.querySelector('input')).toBe(draft);
        expect(draft?.value).toBe('Unapplied filter draft');
        if (order !== 'dispose together') {
          await render(order === 'expense first', order === 'filters first');
          expect(host.querySelectorAll('dialog[open]')).toHaveLength(1);
          expect(document.body.style.overflow).toBe('hidden');
        }
        await render(false, false);
        expect(host.querySelectorAll('dialog[open]')).toHaveLength(0);
        expect(document.body.style.overflow).toBe('scroll');
        expect(document.body.style.getPropertyPriority('overflow')).toBe(
          'important',
        );
      } finally {
        await act(async () => root.unmount());
        host.remove();
        if (previous)
          document.body.style.setProperty('overflow', previous, priority);
        else document.body.style.removeProperty('overflow');
      }
    },
  );
}
