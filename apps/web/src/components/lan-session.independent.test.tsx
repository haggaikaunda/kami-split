// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMockData } from '../lib/data/mock';
import { AppDataProvider, useAppData, type AppData } from './data-provider';
import {
  NavigationProvider,
  useExpenseNavigation,
} from './navigation/provider';
import { SessionCommandProvider } from './session-command';
import { ExpenseDeletionProvider } from './expense-delete';
import { ExpenseDestination } from './navigation/expense';
import { HouseholdCommandsProvider } from './household-controller';
import { Household } from './household';

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => router,
}));
vi.mock('next/link', () => ({ default: 'a' }));
let root: Root;
let source: ReturnType<typeof createMockData>;
let nav: ReturnType<typeof useExpenseNavigation>;
let data: AppData;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function Probe() {
  const navigation = useExpenseNavigation();
  const current = useAppData();
  useEffect(() => {
    nav = navigation;
    data = current;
  }, [navigation, current]);
  return <button id="source-row">Source row</button>;
}
async function render(
  screen: 'navigation' | 'expense' | 'household' = 'navigation',
) {
  await act(async () =>
    root.render(
      <NavigationProvider>
        <AppDataProvider source={source}>
          <SessionCommandProvider>
            <ExpenseDeletionProvider>
              <HouseholdCommandsProvider>
                <Probe />
                {screen === 'expense' ? (
                  <ExpenseDestination expenseId="102" />
                ) : screen === 'household' ? (
                  <Household />
                ) : (
                  <h1>History</h1>
                )}
              </HouseholdCommandsProvider>
            </ExpenseDeletionProvider>
          </SessionCommandProvider>
        </AppDataProvider>
      </NavigationProvider>,
    ),
  );
}
async function click(text: string, last = false) {
  const matches = [...document.querySelectorAll('button')].filter(
    (button) => button.textContent === text,
  );
  expect(matches.length, text).toBeGreaterThan(0);
  await act(async () => (last ? matches.at(-1)! : matches[0]).click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  // Match plain HTTP LAN browsers: secure-context randomUUID is absent,
  // but the standard secure random byte API remains available.
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal('crypto', { getRandomValues });
  expect(crypto.randomUUID).toBeUndefined();
  window.history.replaceState({}, '', '/history?search=meal');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  source = createMockData();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('independently starts navigation and retains one draft operation across edits and resume without randomUUID', async () => {
  await render();
  const entry = window.history.state.kamiEntry;
  expect(entry).toMatch(uuid);
  await act(async () => nav.openExpense('102', 'source-row'));
  const first = new URL(
    router.push.mock.calls.at(-1)![0],
    window.location.origin,
  );
  const visit = first.searchParams.get('visit')!;
  expect(visit).toMatch(uuid);
  expect(visit).not.toBe(entry);
  expect(nav.getSource(visit)).toMatchObject({
    href: '/history?search=meal',
    focusId: 'source-row',
  });
  await act(async () => nav.openDraft('new-expense', 'source-row'));
  const draftHref = router.push.mock.calls.at(-1)![0];
  window.history.replaceState({}, '', draftHref);
  await render();
  await act(async () =>
    nav.updateDraft('new-expense', { description: 'First' }),
  );
  const operationId = nav.drafts['new-expense'].operationId;
  expect(operationId).toMatch(uuid);
  await act(async () =>
    nav.updateDraft('new-expense', { description: 'Updated' }),
  );
  await act(async () => nav.resumeDraft('new-expense'));
  const resume = new URL(
    router.push.mock.calls.at(-1)![0],
    window.location.origin,
  );
  expect(resume.pathname).toBe('/drafts/new-expense');
  expect(resume.searchParams.get('visit')).toMatch(uuid);
  expect(nav.drafts['new-expense'].operationId).toBe(operationId);
  expect(nav.drafts['new-expense'].values).toEqual({ description: 'Updated' });
});

it('independently recovers a committed deletion on LAN with one original operation and one tombstone', async () => {
  const execute = vi.spyOn(source.port, 'execute');
  const operation = vi.spyOn(source.port, 'operation');
  window.history.replaceState({}, '', '/expenses/102');
  await render('expense');
  await click('Delete expense');
  await act(async () => source.demo.scenario('timeout-after-commit'));
  await click('Delete expense', true);
  expect(data.pendingOperations).toBe(1);
  const request = execute.mock.calls[0][0];
  expect(request.operationId).toMatch(uuid);
  expect(request.command.kind).toBe('delete-expense');
  await click('Check deletion status');
  expect(operation).toHaveBeenCalledWith('household-demo', request.operationId);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(data.pendingOperations).toBe(0);
  expect(data.snapshot!.expenses.find((row) => row.id === '102')).toMatchObject(
    { deleted: true, version: 2 },
  );
  expect(
    data.snapshot!.activity.filter(
      (row) => row.kind === 'deleted' && row.recordId === '102',
    ),
  ).toHaveLength(1);
});

it('independently retries an unstarted household operation with the unchanged fallback ID after route remount', async () => {
  const execute = vi
    .spyOn(source.port, 'execute')
    .mockResolvedValueOnce({ status: 'unknown' });
  const operation = vi.spyOn(source.port, 'operation');
  window.history.replaceState({}, '', '/household');
  await render('household');
  const label = [...document.querySelectorAll('label')].find(
    (row) => row.textContent === 'Preview member name',
  )!;
  const input = document.getElementById(label.htmlFor)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, 'LAN Guest');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Create preview invitation');
  expect(data.pendingOperations).toBe(1);
  const request = execute.mock.calls[0][0];
  expect(request.operationId).toMatch(uuid);
  await render();
  await render('household');
  await click('Check household change');
  expect(operation).toHaveBeenCalledWith('household-demo', request.operationId);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[1][0]).toEqual(request);
  expect(data.pendingOperations).toBe(0);
  expect(
    data.snapshot!.members.filter((row) => row.name === 'LAN Guest'),
  ).toHaveLength(1);
});
