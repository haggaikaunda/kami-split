// @vitest-environment jsdom
import { act, type AnchorHTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../../lib/data/fixtures';
import type { Snapshot } from '../../lib/data/port';
import { ExpenseDestination } from './expense';
import { ExpenseLink } from './links';
const harness = vi.hoisted(() => ({
  params: new URLSearchParams(),
  snapshot: undefined as Snapshot | undefined,
  status: 'ready',
  refresh: vi.fn(),
  replace: vi.fn(),
  openContext: vi.fn(),
  openExpense: vi.fn(),
  source: undefined as object | undefined,
}));
vi.mock('../data-provider', () => ({
  useAppData: () => ({ ...harness, readyVersion: 0 }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => harness.params,
  useRouter: () => ({ replace: harness.replace }),
}));
vi.mock('./provider', () => ({
  useRouteReady: vi.fn(),
  useExpenseNavigation: () => ({
    getSource: () => harness.source,
    returnToSource: vi.fn(),
    openContext: harness.openContext,
    openExpense: harness.openExpense,
  }),
}));
vi.mock('next/link', () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  harness.snapshot = fixture('sample', '2026-09-20');
  harness.status = 'ready';
  harness.params = new URLSearchParams();
  harness.source = undefined;
  Object.defineProperty(window, 'innerWidth', {
    value: 1280,
    configurable: true,
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});
function render(id = '2', intercepted = false) {
  act(() =>
    root.render(
      <ExpenseDestination
        expenseId={id}
        intercepted={intercepted}
        renderActions={() => <button>Connected edit</button>}
      />,
    ),
  );
}

describe('async expense destination', () => {
  it.each(['loading', 'denied', 'expired', 'error', 'unavailable'])(
    'never exposes financial fields without a permitted snapshot: %s',
    (status) => {
      harness.status = status;
      harness.snapshot = undefined;
      render();
      expect(container.textContent).not.toContain('Juniper');
      expect(container.querySelector('.expense-values')).toBeNull();
      expect(container.querySelector('.expense-revisions')).toBeNull();
      expect(container.textContent).not.toContain('Connected edit');
      expect(container.querySelector('h1')?.textContent).toBe(
        status === 'loading' ? 'Loading expense' : 'Expense unavailable',
      );
    },
  );
  it('suppresses old record data immediately when access is denied or expires', () => {
    for (const status of ['denied', 'expired']) {
      harness.status = status;
      render();
      expect(container.querySelector('.expense-values')).toBeNull();
      expect(container.textContent).not.toContain('Juniper');
    }
  });
  it('reveals no household fields for an unavailable record ID', () => {
    render('other-household-record');
    expect(container.querySelector('.expense-values')).toBeNull();
    expect(container.textContent).not.toContain('Kaunda');
    expect(container.textContent).toContain('No financial details');
  });
  it('labels offline values stale, hides actions, and retries through the shared port provider', () => {
    harness.status = 'stale';
    render();
    expect(container.textContent).toContain('previously loaded values');
    expect(container.textContent).toContain('68.00 USD');
    expect(container.textContent).not.toContain('Connected edit');
    const retry = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Retry loading expense',
    )!;
    act(() => retry.click());
    expect(harness.refresh).toHaveBeenCalledOnce();
    harness.status = 'ready';
    render();
    expect(container.textContent).toContain('Connected edit');
    harness.status = 'denied';
    harness.snapshot = undefined;
    render();
    expect(container.querySelector('.expense-values')).toBeNull();
  });
  it('keeps selected revision and visit when replacing a contextual panel with a full page', () => {
    harness.params = new URLSearchParams('visit=visit-a&revision=1');
    harness.source = {};
    window.history.replaceState({}, '', '/expenses/2?visit=visit-a&revision=1');
    render('2', true);
    expect(container.querySelector('dialog[open]')).toBeTruthy();
    expect(container.querySelector('details[open]')?.textContent).toContain(
      'Revision 1',
    );
    const full = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Open full page',
    )!;
    act(() => full.click());
    expect(harness.replace).toHaveBeenCalledWith(
      '/expenses/2?visit=visit-a&revision=1&view=full',
      { scroll: false },
    );
  });
  it('exposes revision-aware semantic links and preserves canonical modified-click behavior', () => {
    act(() =>
      root.render(
        <ExpenseLink expenseId="2" revision={1} id="event-2">
          Created dinner
        </ExpenseLink>,
      ),
    );
    const link = container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/expenses/2?revision=1');
    act(() => link.click());
    expect(harness.openContext).toHaveBeenCalledWith(
      '/expenses/2?revision=1',
      'event-2',
    );
    harness.openContext.mockClear();
    link.addEventListener('click', (event) => event.preventDefault(), {
      once: true,
    });
    act(() =>
      link.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }),
      ),
    );
    expect(harness.openContext).not.toHaveBeenCalled();
  });
});
