// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createMockData } from '../../lib/data/mock';
import {
  AppDataProvider,
  useAppData,
  type AppData,
  type AppDataSource,
} from '../data-provider';
import { NavigationProvider } from '../navigation/provider';
import { SessionCommandProvider } from '../session-command';
import { RecordRepayment } from './form';
import { RepaymentDetail } from './detail';
import { overview } from '../../lib/overview';
const nav = vi.hoisted(() => ({
  path: '/repayments/new',
  params: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.path,
  useSearchParams: () => nav.params,
  useRouter: () => nav.router,
}));
vi.mock('next/link', () => ({ default: 'a' }));
let root: Root;
let source: AppDataSource;
let api: AppData;
function Probe() {
  const data = useAppData();
  useEffect(() => {
    api = data;
  }, [data]);
  return null;
}
async function render(detail?: string) {
  await act(async () =>
    root.render(
      <NavigationProvider>
        <AppDataProvider source={source}>
          <SessionCommandProvider>
            <Probe />
            {detail ? (
              <RepaymentDetail repaymentId={detail} />
            ) : (
              <RecordRepayment />
            )}
          </SessionCommandProvider>
        </AppDataProvider>
      </NavigationProvider>,
    ),
  );
}
function field(key: string) {
  return document.getElementById(`repayment-${key}`) as HTMLInputElement;
}
async function edit(key: string, value: string) {
  await act(async () => {
    const element = field(key);
    const prototype =
      element.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(
      new Event(element.tagName === 'SELECT' ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  });
}
async function click(text: string) {
  await act(async () =>
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent === text)!
      .click(),
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  nav.path = '/repayments/new';
  nav.params = new URLSearchParams();
  window.history.replaceState({}, '', nav.path);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  source = createMockData();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
it('requires explicit distinct members in three-member households and never accepts zero or fractional minor units', async () => {
  source = createMockData({ fixture: 'three-members' });
  const execute = vi.spyOn(source.port, 'execute');
  await render();
  expect(field('senderId').value).toBe('');
  expect(field('recipientId').value).toBe('');
  await edit('amount', '1.00');
  await click('Record repayment');
  expect(execute).not.toHaveBeenCalled();
  await edit('senderId', 'member-r');
  await edit('recipientId', 'member-r');
  await click('Record repayment');
  expect(document.body.textContent).toContain(
    'Choose a different active recipient.',
  );
  await edit('recipientId', 'member-k');
  for (const invalid of ['0', '0.001', '-2', 'NaN']) {
    await edit('amount', invalid);
    await click('Record repayment');
  }
  expect(execute).not.toHaveBeenCalled();
});
it('a partial repayment changes only the named pair positions and leaves every expense financial field unchanged', async () => {
  await render();
  const before = api.snapshot!;
  const totals = overview(before);
  await edit('amount', '20.01');
  expect(document.body.textContent).toContain('Kaunda owes Mizenin 22.17 USD.');
  await edit('note', 'Cash already returned');
  await click('Record repayment');
  const after = api.snapshot!;
  const updated = overview(after);
  expect(after.expenses).toEqual(before.expenses);
  expect(updated.spending).toBe(totals.spending);
  expect(updated.positions.map((row) => row.paid)).toEqual(
    totals.positions.map((row) => row.paid),
  );
  expect(
    updated.positions.map(
      (row, index) => row.net - totals.positions[index].net,
    ),
  ).toEqual([2001, -2001]);
  expect(
    after.activity.filter((event) => event.kind === 'repayment'),
  ).toHaveLength(
    before.activity.filter((event) => event.kind === 'repayment').length + 1,
  );
  expect(after.repayments.find((row) => row.amount === 2001)?.note).toBe(
    'Cash already returned',
  );
});
it('a previously acknowledged reversal must be acknowledged again when current debt changes', async () => {
  await render();
  await edit('amount', '50.00');
  await act(async () => field('acknowledged').click());
  expect(field('acknowledged').checked).toBe(true);
  await act(async () => {
    await source.port.execute({
      householdId: 'household-demo',
      operationId: 'other-repayment',
      command: {
        kind: 'record-repayment',
        value: {
          senderId: 'member-k',
          recipientId: 'member-m',
          amount: 100,
          currency: 'USD',
          effectiveDate: '2026-09-20',
          note: 'Other member update',
        },
      },
    });
  });
  expect(field('acknowledged').checked).toBe(false);
  const before = api.snapshot!.repayments.length;
  await click('Record repayment');
  expect(api.snapshot!.repayments).toHaveLength(before);
  expect(document.body.textContent).toContain(
    'Acknowledge the balance in the opposite direction.',
  );
});
it('denied data hides financial inputs and preserves a dirty repayment until access is restored', async () => {
  await render();
  await edit('note', 'Keep unsaved note');
  await edit('amount', '1.23');
  await act(async () => api.demo!.scenario('denied'));
  expect(document.querySelector('input')).toBeNull();
  expect(document.body.textContent).not.toContain('42.18 USD');
  await act(async () => api.demo!.scenario('normal'));
  expect(field('note').value).toBe('Keep unsaved note');
  expect(field('amount').value).toBe('1.23');
});
it('read-only repayment detail exposes recorded values and no mutation actions, and hides them on expired access', async () => {
  nav.path = '/repayments/repayment-4';
  await render('repayment-4');
  expect(document.body.textContent).toContain('25.00 USD');
  expect(document.body.textContent).toContain('read-only');
  expect(document.querySelector('input')).toBeNull();
  expect(
    [...document.querySelectorAll('button')].map(
      (button) => button.textContent,
    ),
  ).not.toContain('Delete');
  await act(async () => api.demo!.scenario('expired'));
  expect(document.body.textContent).not.toContain('25.00 USD');
  expect(document.body.textContent).toContain('unavailable');
});
it('an uncertain committed repayment blocks reset and actor-switched recovery, then resolves its original operation once', async () => {
  const execute = vi.spyOn(source.port, 'execute');
  const operation = vi.spyOn(source.port, 'operation');
  await render();
  await edit('amount', '3.17');
  await act(async () => api.demo!.scenario('timeout-after-commit'));
  await click('Record repayment');
  expect(api.pendingOperations).toBe(1);
  const epoch = api.sessionEpoch;
  await act(async () => api.demo!.reset('empty'));
  expect(api.sessionEpoch).toBe(epoch);
  await act(async () => api.demo!.actor('member-m'));
  await click('Check repayment status and retry safely');
  expect(operation).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledTimes(1);
  await act(async () => api.demo!.actor('member-k'));
  await click('Check repayment status and retry safely');
  expect(operation).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(
    api.snapshot!.repayments.filter((row) => row.amount === 317),
  ).toHaveLength(1);
  expect(api.pendingOperations).toBe(0);
  await act(async () => api.demo!.reset('empty'));
  expect(api.sessionEpoch).toBe(epoch + 1);
  expect(api.snapshot!.repayments).toHaveLength(0);
  expect(document.body.textContent).not.toContain('Repayment recorded.');
});
