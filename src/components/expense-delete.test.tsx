// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AppDataProvider,
  useAppData,
  type AppData,
  type AppDataSource,
} from './data-provider';
import { ExpenseDeletionProvider, DeleteExpenseButton } from './expense-delete';
import { ExpenseRecordView } from './expense-record';
import { createMockData } from '../lib/data/mock';
import { overview } from '../lib/overview';
import { spending } from '../lib/ledger';
const route = vi.hoisted(() => ({ pathname: '/expenses/102' }));
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams('visit=original'),
}));
vi.mock('./navigation/provider', () => ({
  useExpenseNavigation: () => ({
    refreshVersion: 0,
    drafts: {},
    discardDraft: vi.fn(),
  }),
}));
vi.mock('next/link', () => ({ default: 'a' }));
let root: Root;
let api: AppData;
function Screen() {
  const data = useAppData();
  useEffect(() => {
    api = data;
  }, [data]);
  const row = data.snapshot?.expenses.find((entry) => entry.id === '102');
  return row && data.snapshot ? (
    <ExpenseRecordView
      record={row}
      snapshot={data.snapshot}
      renderActions={(record) => <DeleteExpenseButton record={record} />}
    />
  ) : (
    <p>Unavailable</p>
  );
}
async function mount(source: AppDataSource) {
  await act(async () =>
    root.render(
      <AppDataProvider source={source}>
        <ExpenseDeletionProvider>
          <Screen />
        </ExpenseDeletionProvider>
      </AppDataProvider>,
    ),
  );
}
function buttons(name: string) {
  return [...document.querySelectorAll('button')].filter(
    (button) => button.textContent === name,
  );
}
async function click(name: string, last = false) {
  await act(async () =>
    (last ? buttons(name).at(-1)! : buttons(name)[0]).click(),
  );
}
function dialog() {
  return document.querySelector('dialog')!;
}
async function reason(value: string) {
  await act(async () => {
    const input = dialog().querySelector('input')!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(() => {
  route.pathname = '/expenses/102';
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
it('names amount, focuses Keep, preserves reason after Keep and Escape without changing URL', async () => {
  await mount(createMockData());
  await click('Delete expense');
  expect(dialog().textContent).toContain('Poke');
  expect(dialog().textContent).toContain('USD');
  expect(document.activeElement?.textContent).toBe('Keep expense');
  await reason('Duplicate receipt');
  await click('Keep expense');
  expect(dialog().open).toBe(false);
  expect(
    api.snapshot!.expenses.find((row) => row.id === '102')!.deleted,
  ).toBeFalsy();
  await click('Delete expense');
  expect(dialog().querySelector('input')!.value).toBe('Duplicate receipt');
  await act(async () =>
    dialog().dispatchEvent(new Event('cancel', { cancelable: true })),
  );
  expect(dialog().open).toBe(false);
  expect(route.pathname).toBe('/expenses/102');
});
it('soft deletes once, retains immutable audit and reconciles contributions, trip and monthly totals', async () => {
  await mount(createMockData());
  const before = api.snapshot!;
  const row = before.expenses.find((entry) => entry.id === '102')!;
  await click('Delete expense');
  await reason('Accidental duplicate');
  const submit = buttons('Delete expense').at(-1)!;
  submit.focus();
  await act(async () => {
    submit.click();
    submit.click();
  });
  expect(document.activeElement?.textContent).toBe('View retained expense');
  const after = api.snapshot!;
  expect(after.expenses).toHaveLength(before.expenses.length);
  expect(after.expenses.find((entry) => entry.id === '102')?.deleted).toBe(
    true,
  );
  const events = after.activity.filter(
    (event) => event.kind === 'deleted' && event.recordId === '102',
  );
  expect(events).toHaveLength(1);
  expect(events[0].actorId).toBe('member-k');
  expect(
    after.revisions.find((revision) => revision.id === events[0].revisionId)
      ?.reason,
  ).toBe('Accidental duplicate');
  expect(overview(after).spending).toBe(overview(before).spending - row.amount);
  expect(
    overview(after).positions.reduce((total, member) => total + member.net, 0),
  ).toBe(0);
  expect(
    spending(after.expenses, { currency: 'USD', tripId: row.tripId! }).total,
  ).toBe(
    spending(before.expenses, { currency: 'USD', tripId: row.tripId! }).total -
      row.amount,
  );
  expect(
    spending(after.expenses, {
      currency: 'USD',
      start: '2026-09-01',
      end: '2026-09-30',
    }).total,
  ).toBe(
    spending(before.expenses, {
      currency: 'USD',
      start: '2026-09-01',
      end: '2026-09-30',
    }).total - row.amount,
  );
  expect(api.pendingOperations).toBe(0);
  await click('View retained expense');
  expect(buttons('Delete expense')).toHaveLength(0);
  expect(document.body.textContent).toContain('This expense was deleted.');
});
it('holds reset lock on unknown and confirms the original operation without duplicate deletion', async () => {
  const source = createMockData();
  await mount(source);
  await click('Delete expense');
  await act(async () => api.demo!.scenario('timeout-after-commit'));
  await click('Delete expense', true);
  expect(dialog().textContent).toContain('may have completed');
  expect(api.pendingOperations).toBe(1);
  const epoch = api.sessionEpoch;
  await act(async () => api.demo!.reset('empty'));
  expect(api.sessionEpoch).toBe(epoch);
  await click('Check deletion status');
  expect(api.pendingOperations).toBe(0);
  expect(
    api.snapshot!.activity.filter(
      (event) => event.kind === 'deleted' && event.recordId === '102',
    ),
  ).toHaveLength(1);
});
it('requires reviewing the latest revision after a conflict, and preserves reason', async () => {
  await mount(createMockData());
  await click('Delete expense');
  await reason('Duplicate');
  await act(async () => api.demo!.scenario('second-editor'));
  buttons('Delete expense').at(-1)!.focus();
  await click('Delete expense', true);
  expect(document.activeElement?.textContent).toBe('Review latest revision');
  expect(dialog().textContent).toContain('This expense changed');
  expect(
    api.snapshot!.expenses.find((row) => row.id === '102')!.deleted,
  ).toBeFalsy();
  await click('Review latest revision');
  expect(dialog().querySelector('input')!.value).toBe('Duplicate');
  await click('Delete expense', true);
  expect(api.snapshot!.expenses.find((row) => row.id === '102')!.deleted).toBe(
    true,
  );
});
it('reports concurrent deletion and hides confirmation after browser source navigation', async () => {
  const source = createMockData();
  await mount(source);
  await click('Delete expense');
  await act(async () => api.demo!.scenario('concurrent-delete'));
  await click('Delete expense', true);
  expect(dialog().textContent).toContain('already deleted');
  route.pathname = '/history';
  await mount(source);
  expect(dialog().open).toBe(false);
});
it('does not reveal another actor’s retained confirmation or recover their unknown operation', async () => {
  await mount(createMockData());
  await click('Delete expense');
  await reason('Private reason');
  await act(async () => api.demo!.scenario('timeout-after-commit'));
  await click('Delete expense', true);
  await act(async () => api.demo!.actor('member-m'));
  expect(dialog().open).toBe(false);
  expect(dialog().textContent).not.toContain('Private reason');
  expect(buttons('Check deletion status')).toHaveLength(0);
  await act(async () => api.demo!.actor('member-k'));
  await click('Check deletion status');
  expect(api.pendingOperations).toBe(0);
});
it('does not send a retry when the actor changes during an operation lookup', async () => {
  const mock = createMockData();
  let resolve!: (value: { status: 'not-started' }) => void;
  const execute = vi.fn(async () => ({ status: 'unknown' as const }));
  const operation = vi.fn(
    () =>
      new Promise<{ status: 'not-started' }>((done) => {
        resolve = done;
      }),
  );
  await mount({ port: { ...mock.port, execute, operation }, demo: mock.demo });
  await click('Delete expense');
  await click('Delete expense', true);
  await click('Check deletion status');
  await act(async () => api.demo!.actor('member-m'));
  await act(async () => resolve({ status: 'not-started' }));
  expect(execute).toHaveBeenCalledTimes(1);
  expect(api.pendingOperations).toBe(1);
});
it('keeps dirty reasons during navigation, but discards them after simulation reset', async () => {
  const source = createMockData();
  await mount(source);
  await click('Delete expense');
  await reason('Keep on this visit');
  route.pathname = '/history';
  await mount(source);
  expect(dialog().open).toBe(false);
  route.pathname = '/expenses/102';
  await mount(source);
  await click('Keep expense');
  await click('Delete expense');
  expect(dialog().querySelector('input')!.value).toBe('Keep on this visit');
  await click('Keep expense');
  await act(async () => api.demo!.reset());
  await click('Delete expense');
  expect(dialog().querySelector('input')!.value).toBe('');
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
it('focuses the conflict action after a delayed latest-record refresh becomes ready', async () => {
  const source = createMockData();
  await mount(source);
  await click('Delete expense');
  const snapshot = api.snapshot!;
  const current = {
    ...snapshot.expenses.find((row) => row.id === '102')!,
    version: 2,
  };
  vi.spyOn(source.port, 'execute').mockResolvedValue({
    status: 'conflict',
    current,
  });
  let complete!: () => void;
  vi.spyOn(source.port, 'read').mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = () =>
          resolve({
            status: 'ok',
            value: {
              ...snapshot,
              expenses: snapshot.expenses.map((row) =>
                row.id === '102' ? current : row,
              ),
            },
          });
      }),
  );
  buttons('Delete expense').at(-1)!.focus();
  await click('Delete expense', true);
  expect(buttons('Review latest revision')[0].disabled).toBe(true);
  await act(async () => complete());
  expect(document.activeElement?.textContent).toBe('Review latest revision');
});
