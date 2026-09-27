// @vitest-environment jsdom
import { act, type AnchorHTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataProvider, type AppDataSource } from './data-provider';
import { Overview } from './overview';
import { createMockData } from '@/lib/data/mock';
import type { Outcome, Snapshot } from '@/lib/data/port';
const nav = vi.hoisted(() => ({
  refreshVersion: 0,
  isActive: true,
  drafts: {},
  discardDraft: vi.fn(),
  openExpense: vi.fn(),
  openDraft: vi.fn(),
  openContext: vi.fn(),
}));
vi.mock('./navigation/provider', () => ({
  useExpenseNavigation: () => nav,
  useRouteReady: vi.fn(),
  useRouteContext: () => ({
    isActive: nav.isActive,
    searchParams: new URLSearchParams(),
  }),
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
let root: Root;
let container: HTMLDivElement;
async function mount(source: AppDataSource) {
  await act(async () => {
    root.render(
      <AppDataProvider source={source}>
        <Overview />
      </AppDataProvider>,
    );
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.clearAllMocks();
  nav.isActive = true;
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});
describe('data-backed overview', () => {
  it('waits for real data, then renders the exact seed balance and contributions', async () => {
    const source = createMockData();
    const result = await source.port.read('household-demo');
    let resolve!: (value: Outcome<Snapshot>) => void;
    await mount({
      port: {
        ...source.port,
        read: () =>
          new Promise((done) => {
            resolve = done;
          }),
      },
    });
    expect(container.textContent).toContain('Loading your household');
    expect(container.textContent).not.toContain('$0');
    expect(container.textContent).not.toContain('settled');
    await act(async () => resolve(result));
    expect(container.querySelector('#balance-heading')?.textContent).toBe(
      'Kaunda owes Mizenin',
    );
    expect(
      container.querySelector('.overview-balance-amount')?.textContent,
    ).toBe('$42.18 USD');
    expect(
      container.querySelector('.overview-contributions')?.textContent,
    ).toContain('$2,496.10 USD');
    expect(
      container.querySelector('.overview-contributions')?.textContent,
    ).toContain('$2,630.46 USD');
    expect(container.textContent).toContain('$5,126.56 USD');
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'How this adds up',
    )!;
    act(() => button.click());
    expect(container.querySelector('dialog[open]')?.textContent).toContain(
      'allocated share − expenses paid − repayments sent + repayments received',
    );
    expect(
      container.querySelector('.overview-explanation')?.textContent,
    ).toContain('$2,563.28 USD');
    expect(
      container.querySelector('.overview-explanation')?.textContent,
    ).toContain('$25.00 USD');
  });
  it('captures stable recent-activity context and repayment entry without placing draft values in links', async () => {
    await mount(createMockData());
    const expense = container.querySelector<HTMLAnchorElement>(
      'a[href="/expenses/1?revision=1"]',
    )!;
    act(() => expense.click());
    expect(nav.openContext).toHaveBeenCalledWith(
      '/expenses/1?revision=1',
      'overview-event-event-1',
    );
    const repayment = container.querySelector<HTMLAnchorElement>(
      '#overview-record-repayment',
    )!;
    act(() => repayment.click());
    expect(nav.openContext).toHaveBeenCalledWith(
      '/repayments/new',
      'overview-record-repayment',
    );
    expect(container.querySelector('.overview-events')?.textContent).toContain(
      'Repayment recorded',
    );
  });
  it('suspends explanation and reset dialogs while the overview is a retained background', async () => {
    const source = createMockData();
    await mount(source);
    const explain = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'How this adds up',
    )!;
    act(() => explain.click());
    expect(container.querySelectorAll('dialog[open]')).toHaveLength(1);
    nav.isActive = false;
    await mount(source);
    expect(container.querySelectorAll('dialog[open]')).toHaveLength(0);
    nav.isActive = true;
    await mount(source);
    const close = container.querySelector<HTMLButtonElement>(
      '[aria-label="Close How this adds up"]',
    )!;
    act(() => close.click());
    const reset = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Reset simulation',
    )!;
    act(() => reset.click());
    expect(container.querySelectorAll('dialog[open]')).toHaveLength(1);
    nav.isActive = false;
    await mount(source);
    expect(container.querySelectorAll('dialog[open]')).toHaveLength(0);
  });
  it('keeps the selected scenario and recovery controls stable after access is cleared', async () => {
    await mount(createMockData());
    const details = container.querySelector('details')!;
    details.open = true;
    const scenario = details.querySelector('select')!;
    await act(async () => {
      scenario.value = 'denied';
      scenario.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain(
      'not available to the simulated actor',
    );
    expect(container.querySelector('details')).toBe(details);
    expect(details.open).toBe(true);
    expect(details.querySelector('select')!.value).toBe('denied');
    await act(async () => {
      scenario.value = 'normal';
      scenario.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('#balance-heading')?.textContent).toBe(
      'Kaunda owes Mizenin',
    );
  });
  it('labels stale data and removes private amounts after denial', async () => {
    const source = createMockData();
    await mount(source);
    await act(async () => source.demo.scenario('offline'));
    expect(container.textContent).toContain(
      'Showing the last available household data',
    );
    expect(container.textContent).toContain('$42.18 USD');
    await act(async () => source.demo.scenario('denied'));
    expect(container.textContent).not.toContain('$42.18');
    expect(container.querySelector('.overview-contributions')).toBeNull();
    expect(container.textContent).toContain(
      'not available to the simulated actor',
    );
  });
  it('gives an empty household a first-expense state and displays every three-member direct obligation', async () => {
    const source = createMockData({ fixture: 'empty' });
    await mount(source);
    expect(container.textContent).toContain('No shared expenses yet');
    expect(container.textContent).not.toContain('You’re all settled up');
    expect(container.textContent).toContain('Add your first expense');
    await act(async () => source.demo.reset('three-members'));
    const obligations = container.querySelector(
      '.overview-obligations',
    )!.textContent;
    expect(obligations).toContain('Kaunda owes Mizenin $19.84 USD');
    expect(obligations).toContain('River owes Kaunda $832.01 USD');
    expect(obligations).toContain('River owes Mizenin $876.78 USD');
  });
});
