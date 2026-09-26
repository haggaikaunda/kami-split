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
it('independently preserves a failed deletion reason and retries only after access returns', async () => {
  const mock = createMockData();
  const execute = vi.fn(mock.port.execute);
  execute.mockResolvedValueOnce({ status: 'denied' });
  await mount({ port: { ...mock.port, execute }, demo: mock.demo });
  await click('Delete expense');
  await reason('Wrong receipt');
  await click('Delete expense', true);
  expect(dialog().textContent).toContain('Deletion was not completed');
  expect(dialog().querySelector('input')!.value).toBe('Wrong receipt');
  expect(api.pendingOperations).toBe(0);
  expect(
    api.snapshot!.expenses.find((row) => row.id === '102')!.deleted,
  ).toBeFalsy();
  await act(async () => api.demo!.scenario('denied'));
  expect(dialog().open).toBe(false);
  expect(document.body.textContent).not.toContain('Wrong receipt');
  await act(async () => {
    api.demo!.scenario('normal');
    await api.refresh();
  });
  await click('Delete expense', true);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(api.snapshot!.expenses.find((row) => row.id === '102')!.deleted).toBe(
    true,
  );
  expect(
    api.snapshot!.activity.filter(
      (event) => event.kind === 'deleted' && event.recordId === '102',
    ),
  ).toHaveLength(1);
});
it('independently completes after leaving the source without reopening the confirmation or stealing focus', async () => {
  const mock = createMockData();
  let finish!: () => void;
  const execute = vi.fn(
    (envelope: Parameters<typeof mock.port.execute>[0]) =>
      new Promise<Awaited<ReturnType<typeof mock.port.execute>>>((resolve) => {
        finish = () => {
          void mock.port.execute(envelope).then(resolve);
        };
      }),
  );
  const source = { port: { ...mock.port, execute }, demo: mock.demo };
  await mount(source);
  await click('Delete expense');
  await reason('Duplicate from another screen');
  await click('Delete expense', true);
  expect(api.pendingOperations).toBe(1);
  route.pathname = '/history';
  await mount(source);
  const anchor = document.createElement('button');
  anchor.textContent = 'History filter';
  document.body.append(anchor);
  anchor.focus();
  await act(async () => finish());
  expect(api.pendingOperations).toBe(0);
  expect(route.pathname).toBe('/history');
  expect(dialog().open).toBe(false);
  expect(document.activeElement).toBe(anchor);
  expect(execute).toHaveBeenCalledTimes(1);
  const epoch = api.sessionEpoch;
  await act(async () => api.demo!.reset());
  expect(api.sessionEpoch).toBe(epoch + 1);
  expect(
    api.snapshot!.expenses.find((row) => row.id === '102')!.deleted,
  ).toBeFalsy();
  route.pathname = '/expenses/102';
  await mount(source);
  await click('Delete expense');
  expect(dialog().querySelector('input')!.value).toBe('');
});
