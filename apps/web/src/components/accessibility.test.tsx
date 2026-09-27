// @vitest-environment jsdom
import axe from 'axe-core';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMockData } from '../lib/data/mock';
import { AppDataProvider } from './data-provider';
import { NavigationProvider } from './navigation/provider';
import { NavigationShell } from './navigation/shell';
import { SessionCommandProvider } from './session-command';
import { ExpenseDeletionProvider } from './expense-delete';
import { HouseholdCommandsProvider } from './household-controller';
import { Overview } from './overview';
import { History } from './history';
import { TripsList } from './trips/list';
import { TripDestination } from './trips/destination';
import { CreateTrip } from './trips/form';
import { EntryPreview } from './entry-preview';
import { Household } from './household';
import { HouseholdSetup } from './household-setup';
import { AddExpense } from './expense-create/form';
import { EditExpense } from './expense-edit/form';
import { RecordRepayment } from './repayment/form';
import { RepaymentDetail } from './repayment/detail';
import { ExpenseDestination } from './navigation/expense';

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
async function mount(path: string, screen: ReactNode) {
  window.history.replaceState({}, '', path);
  await act(async () =>
    root.render(
      <NavigationProvider>
        <AppDataProvider source={source}>
          <SessionCommandProvider>
            <ExpenseDeletionProvider>
              <HouseholdCommandsProvider>
                <NavigationShell detail={null}>{screen}</NavigationShell>
              </HouseholdCommandsProvider>
            </ExpenseDeletionProvider>
          </SessionCommandProvider>
        </AppDataProvider>
      </NavigationProvider>,
    ),
  );
}
async function audit() {
  // jsdom has no layout/canvas text metrics. Contrast, visible focus, target
  // geometry, zoom/reflow, and native modal trapping require the live QA pass.
  // All other axe rules remain enabled; audit the complete document/landmarks.
  const result = await axe.run(document, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(
    result.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.map(({ target, failureSummary }) => ({
        target,
        failureSummary,
      })),
    })),
  ).toEqual([]);
}
async function click(label: string, last = false) {
  const matches = [...document.querySelectorAll('button')].filter(
    (row) => row.textContent === label,
  );
  expect(matches.length, `Button ${label}`).toBeGreaterThan(0);
  await act(async () => (last ? matches.at(-1)! : matches[0]).click());
}
async function input(id: string, value: string) {
  const element = document.getElementById(id) as HTMLInputElement;
  expect(element, id).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  document.documentElement.lang = 'en';
  document.title = 'Kami Split';
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
});

it.each([
  ['overview with household spending chart', '/', <Overview key="case-1" />],
  ['household chart table', '/?chartData=1', <Overview key="case-2" />],
  [
    'spending bucket dialog',
    '/?bucket=month%3A2026-09',
    <Overview key="case-3" />,
  ],
  [
    'trip chart tables',
    '/trips/maui?dayData=1&categoryData=1',
    <TripDestination key="case-4" tripId="maui" />,
  ],
  [
    'filtered history',
    '/history?type=created&member=member-k',
    <History key="case-5" />,
  ],
  ['trip list', '/trips', <TripsList key="case-6" />],
  [
    'trip detail and spending chart',
    '/trips/maui',
    <TripDestination key="case-7" tripId="maui" />,
  ],
  ['new trip form', '/drafts/new-trip', <CreateTrip key="case-8" />],
  ['entry sign-in', '/sign-in', <EntryPreview key="case-9" />],
  ['household owner controls', '/household', <Household key="case-10" />],
  ['new expense form', '/drafts/new-expense', <AddExpense key="case-11" />],
  [
    'expense edit form',
    '/drafts/edit-expense-102',
    <EditExpense key="case-12" expenseId="102" />,
  ],
  [
    'repayment form',
    '/drafts/new-repayment',
    <RecordRepayment key="case-13" />,
  ],
  [
    'expense detail',
    '/expenses/102',
    <ExpenseDestination key="case-14" expenseId="102" />,
  ],
] as const)('has no axe violations in %s', async (_label, path, screen) => {
  await mount(path, screen);
  expect(document.querySelector('h1, h2')).toBeTruthy();
  await audit();
});

it.each([
  ['overview', '/', <Overview key="case-15" />],
  ['history', '/history', <History key="case-16" />],
  ['trips', '/trips', <TripsList key="case-17" />],
] as const)(
  'audits empty %s using the real fixture',
  async (_name, path, screen) => {
    source.demo.reset('empty');
    await mount(path, screen);
    await audit();
  },
);
it('audits household access denial using the real data gate', async () => {
  source.demo.scenario('denied');
  await mount('/household', <Household />);
  expect(document.body.textContent).toContain('Household unavailable');
  await audit();
});

it('audits setup and invitation entry states reached through the real entry adapter', async () => {
  await source.port.entry.dispatch({
    kind: 'scenario',
    scenario: 'first-household',
  });
  await source.port.entry.dispatch({
    kind: 'request',
    email: 'test@example.test',
  });
  await source.port.entry.dispatch({ kind: 'follow' });
  await mount('/household/setup', <HouseholdSetup />);
  await audit();
  await click('Create preview household');
  await audit();
  await act(async () => {
    await source.port.entry.dispatch({
      kind: 'scenario',
      scenario: 'invitation',
    });
    await source.port.entry.dispatch({
      kind: 'request',
      email: 'test@example.test',
    });
    await source.port.entry.dispatch({ kind: 'follow' });
  });
  await mount('/sign-in', <EntryPreview />);
  expect(document.body.textContent).toContain('Accept invitation');
  await audit();
});

it('audits expense validation and retained unknown-response recovery controls', async () => {
  await mount('/drafts/new-expense', <AddExpense />);
  await click('Save expense');
  await audit();
  await input('create-amount', '10.01');
  await input('create-description', 'Axe recovery meal');
  await act(async () => source.demo.scenario('timeout-after-commit'));
  await click('Save expense');
  expect(document.body.textContent).toContain('save may have completed');
  await audit();
});

it('audits repayment validation and unknown-response recovery controls', async () => {
  await mount('/drafts/new-repayment', <RecordRepayment />);
  await input('repayment-amount', '50.00');
  await click('Record repayment');
  expect(document.body.textContent).toContain('Acknowledge');
  await audit();
  await input('repayment-amount', '10.01');
  await act(async () => source.demo.scenario('timeout-after-commit'));
  await click('Record repayment');
  expect(document.body.textContent).toContain('save may have completed');
  await audit();
});

it('audits the open destructive expense confirmation and retained completion', async () => {
  await mount('/expenses/102', <ExpenseDestination expenseId="102" />);
  await click('Delete expense');
  expect(document.querySelector('dialog[open]')).toBeTruthy();
  await audit();
  await click('Delete expense', true);
  expect(document.body.textContent).toContain('View retained expense');
  await audit();
});

it('audits household removal confirmation and failed validation', async () => {
  await mount('/household', <Household />);
  await click('Remove Mizenin');
  expect(document.querySelector('dialog[open]')).toBeTruthy();
  await audit();
  await click('Remove access');
  expect(document.body.textContent).toContain('outstanding balance');
  await audit();
});

it('audits read-only repayment detail after a real settlement record', async () => {
  const result = await source.port.execute({
    householdId: 'household-demo',
    operationId: 'a11y-repayment',
    command: {
      kind: 'record-repayment',
      value: {
        amount: 1001,
        currency: 'USD',
        senderId: 'member-k',
        recipientId: 'member-m',
        effectiveDate: '2026-09-20',
        note: 'Partial settlement',
      },
    },
  });
  if (result.status !== 'ok') throw new Error(result.status);
  await mount(
    `/repayments/${result.value.id}`,
    <RepaymentDetail repaymentId={result.value.id} />,
  );
  expect(document.body.textContent).toContain('Partial settlement');
  await audit();
});
