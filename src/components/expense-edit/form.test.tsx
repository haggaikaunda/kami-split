// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockData } from '../../lib/data/mock';
import type { Envelope, Entity, Outcome } from '../../lib/data/port';
import {
  AppDataProvider,
  useAppData,
  type AppData,
  type AppDataSource,
} from '../data-provider';
import { NavigationProvider } from '../navigation/provider';
import { SessionCommandProvider } from '../session-command';
import { EditExpense } from './form';
import { spending, positions } from '../../lib/ledger';
const nav = vi.hoisted(() => ({
  path: '/drafts/edit-expense-102',
  params: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.path,
  useSearchParams: () => nav.params,
  useRouter: () => nav.router,
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
let root: Root, container: HTMLDivElement, source: AppDataSource, api: AppData;
function Probe() {
  const data = useAppData();
  useEffect(() => {
    api = data;
  }, [data]);
  return null;
}
async function mount(show = true) {
  await act(async () =>
    root.render(
      <NavigationProvider>
        <AppDataProvider source={source}>
          <SessionCommandProvider>
            <Probe />
            {show && <EditExpense expenseId="102" />}
          </SessionCommandProvider>
        </AppDataProvider>
      </NavigationProvider>,
    ),
  );
}
async function input(key: string, value: string) {
  const element = document.getElementById(`create-${encodeURIComponent(key)}`)!;
  const proto =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  });
}
function button(text: string) {
  return [...container.querySelectorAll('button')].find(
    (node) => node.textContent === text,
  )!;
}
async function click(text: string) {
  expect(button(text)).toBeTruthy();
  await act(async () => button(text).click());
}
async function snapshot() {
  const result = await source.port.read('household-demo');
  if (result.status !== 'ok') throw new Error('fixture');
  return result.value;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  nav.path = '/drafts/edit-expense-102';
  nav.params = new URLSearchParams();
  window.history.replaceState({}, '', nav.path);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  source = createMockData();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
describe('expense editing', () => {
  it('validates all fields, writes one attributed revision, and updates date/trip/category/balance selectors', async () => {
    const before = await snapshot(),
      record = before.expenses.find((row) => row.id === '102')!;
    await mount();
    expect(document.activeElement?.id).toBe('create-amount');
    await input('description', '');
    await input('amount', '10.01');
    await click('Save changes');
    expect(document.activeElement?.id).toBe('create-description');
    await input('description', 'Changed booking');
    await input('effectiveDate', '2026-10-01');
    await input('payerId', 'member-m');
    await input('tripId', 'porto');
    await input('category', 'Accommodation');
    await input('note', 'Edited note');
    await act(async () => api.demo!.actor('member-m'));
    await click('Save changes');
    const after = await snapshot(),
      updated = after.expenses.find((row) => row.id === '102')!;
    expect(updated).toMatchObject({
      amount: 1001,
      description: 'Changed booking',
      effectiveDate: '2026-10-01',
      payerId: 'member-m',
      tripId: 'porto',
      category: 'Accommodation',
      note: 'Edited note',
      version: record.version + 1,
      creatorId: record.creatorId,
      createdAt: record.createdAt,
    });
    expect(updated.allocations.map((row) => row.amount)).toEqual([501, 500]);
    expect(
      after.revisions.find(
        (row) => row.expenseId === '102' && row.version === updated.version,
      )?.actorId,
    ).toBe('member-m');
    expect(
      after.revisions.find(
        (row) => row.expenseId === '102' && row.version === record.version,
      )?.snapshot,
    ).toEqual(record);
    expect(
      spending(after.expenses, { currency: 'USD', tripId: record.tripId! })
        .total,
    ).toBe(
      spending(before.expenses, { currency: 'USD', tripId: record.tripId! })
        .total - record.amount,
    );
    expect(
      spending(after.expenses, {
        currency: 'USD',
        start: '2026-10-01',
        end: '2026-10-31',
      }).total,
    ).toBe(1001);
    expect(
      positions(
        after.members.map((row) => row.id),
        after.expenses,
        after.repayments,
        'USD',
      ).reduce((sum, row) => sum + row.net, 0),
    ).toBe(0);
    expect(nav.router.replace).toHaveBeenLastCalledWith('/expenses/102');
  });
  it('preserves manual zero-share participants across exclusion and cancelled mode switch', async () => {
    await mount();
    await input('amount', '10.01');
    await act(async () =>
      (
        container.querySelectorAll('input[type=radio]')[1] as HTMLInputElement
      ).click(),
    );
    await input('allocation-member-k', '10.01');
    await input('allocation-member-m', '0');
    const second = container.querySelectorAll(
      'input[type=checkbox]',
    )[1] as HTMLInputElement;
    await act(async () => second.click());
    await act(async () => second.click());
    await click('Save changes');
    const updated = (await snapshot()).expenses.find(
      (row) => row.id === '102',
    )!;
    expect(updated.participantIds).toEqual(['member-k', 'member-m']);
    expect(updated.allocations).toEqual([
      { memberId: 'member-k', amount: 1001 },
      { memberId: 'member-m', amount: 0 },
    ]);
  });
  it('compares original/latest/draft, requires explicit reapply, and then uses the latest version', async () => {
    await mount();
    await input('description', 'My retained changes');
    await act(async () => api.demo!.scenario('second-editor'));
    const execute = vi.spyOn(source.port, 'execute');
    await click('Save changes');
    expect(container.textContent).toContain('Original · revision 1');
    expect(container.textContent).toContain('Latest · revision 2');
    expect(container.textContent).toContain(
      'Updated by the simulated second editor',
    );
    expect(container.textContent).toContain('My retained changes');
    expect(button('Save changes').disabled).toBe(true);
    expect(document.activeElement?.textContent).toBe(
      'Review conflicting changes',
    );
    await click('Reapply my draft to revision 2');
    expect(document.activeElement?.id).toBe('create-amount');
    await click('Save changes');
    expect(
      execute.mock.calls.map(([envelope]) =>
        envelope.command.kind === 'update-expense'
          ? envelope.command.expectedVersion
          : 0,
      ),
    ).toEqual([1, 2]);
    expect(execute.mock.calls[0][0].operationId).toBe(
      execute.mock.calls[1][0].operationId,
    );
    expect(
      (await snapshot()).expenses.find((row) => row.id === '102'),
    ).toMatchObject({ version: 3, description: 'My retained changes' });
  });
  it('never resurrects a concurrently deleted record and retains the draft for reference', async () => {
    await mount();
    await input('description', 'Unsaved after deletion');
    await act(async () => api.demo!.scenario('concurrent-delete'));
    const execute = vi.spyOn(source.port, 'execute');
    await click('Save changes');
    expect(container.textContent).toContain('cannot overwrite or restore');
    expect(button('Save changes').disabled).toBe(true);
    expect(
      (document.getElementById('create-description') as HTMLInputElement).value,
    ).toBe('Unsaved after deletion');
    await click('Save changes');
    expect(execute).toHaveBeenCalledOnce();
    expect(
      (await snapshot()).expenses.find((row) => row.id === '102')?.deleted,
    ).toBe(true);
  });
  it('resolves a timeout through operation status without adding a second revision', async () => {
    await mount();
    await input('description', 'One revision');
    await act(async () => api.demo!.scenario('timeout-after-commit'));
    const execute = vi.spyOn(source.port, 'execute');
    await click('Save changes');
    expect(button('Save changes').disabled).toBe(true);
    expect(api.pendingOperations).toBe(1);
    await click('Check save status and retry safely');
    expect(execute).toHaveBeenCalledOnce();
    expect(api.pendingOperations).toBe(0);
    expect(
      (await snapshot()).expenses.find((row) => row.id === '102')?.version,
    ).toBe(2);
  });
  it('suppresses double submit and completes after unmount without navigating elsewhere', async () => {
    const mock = createMockData();
    let finish!: () => void;
    const execute = vi.fn(
      (envelope: Envelope) =>
        new Promise<Outcome<Entity>>((resolve) => {
          finish = () => {
            void mock.port.execute(envelope).then(resolve);
          };
        }),
    );
    source = { port: { ...mock.port, execute }, demo: mock.demo };
    await mount();
    await input('description', 'Pending edit');
    await act(async () => {
      button('Save changes').click();
      button('Save changes').click();
    });
    expect(execute).toHaveBeenCalledOnce();
    window.history.replaceState({}, '', '/history');
    await mount(false);
    await act(async () => finish());
    expect(nav.router.replace).not.toHaveBeenCalled();
    expect(
      (await snapshot()).expenses.find((row) => row.id === '102')?.description,
    ).toBe('Pending edit');
  });
});
