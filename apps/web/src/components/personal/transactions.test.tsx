// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queryEnvironment, relayRoot } from '@/lib/relay/test-queries';
import type { FinancialScope } from '@/lib/relay/environment';
import { PersonalTransactions } from './transactions';
const nav = vi.hoisted(() => ({ search: 'tab=transactions', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/personal',
  useRouter: () => ({ push: nav.push }),
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    onNavigate,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    onNavigate?: unknown;
  }) => {
    void onNavigate;
    return <a {...props}>{children}</a>;
  },
}));
type Request = {
  name: string;
  variables: Record<string, unknown>;
  next: (data: unknown) => void;
  error: (error?: Error) => void;
};
let root: Root, host: HTMLDivElement, scope: FinancialScope;
const requests: Request[] = [];
const row = (id = 'source-1') => ({
  id: `fact-${id}`,
  sourceId: id,
  accountId: 'account',
  bindingId: 'binding',
  sourceRevision: '1',
  latestSourceRevision: '2',
  bankDate: '2026-10-17',
  amountMinor: '10000',
  currency: 'USD',
  merchantName: 'Private merchant',
  name: 'Bank fact',
  processingState: 'posted',
  activity: 'purchase',
  category: 'FOOD_AND_DRINK',
  excluded: false,
  reviewed: false,
  materialConflict: false,
  current: true,
  currentId: id,
  discrepancy: 'none',
  archives: [
    {
      archiveId: 'archive',
      sourceRevision: '1',
      annotationRevision: '3',
      annotation: {
        revision: '3',
        note: 'Original private note',
        excluded: true,
        reviewed: false,
      },
    },
  ],
});
let reportSequence = 0;
const report = (overrides: Record<string, unknown> = {}) => ({
  bankingReport: {
    id: `report-${reportSequence++}`,
    code: 'READY',
    fieldErrors: [],
    start: '2026-10-01',
    end: '2026-10-17',
    asOfDate: '2026-10-17',
    timezone: 'America/Los_Angeles',
    revision: 'rev',
    totalCount: 125,
    spendingContext: 'SPENDING_FROM_ACCOUNTS',
    endCursor: 'signed',
    hasNextPage: true,
    activityChoices: ['purchase', 'refund', 'income', 'transfer', 'unresolved'],
    categoryChoices: ['FOOD_AND_DRINK', 'UNCATEGORIZED'],
    counts: {
      count: 125,
      postedCount: 123,
      pendingCount: 2,
      removedCount: 0,
      excludedCount: 1,
      unresolvedCount: 1,
      reviewedCount: 120,
      classificationComplete: false,
    },
    summary: {
      netMinor: '-4000',
      purchaseMinor: '10000',
      refundMinor: '14000',
      classificationComplete: false,
    },
    accounts: [
      {
        id: 'snapshot-account',
        accountId: 'account',
        kind: 'checking',
        selected: true,
        coverage: 'PARTIAL',
        planId: 'plan',
        transitionDate: '2026-09-30',
        archives: [
          {
            id: 'archive',
            planId: 'old-plan',
            boundaryDate: '2026-09-30',
            count: 130,
          },
        ],
        intervals: [
          {
            bindingId: 'binding',
            afterDate: null,
            throughDate: '2026-09-30',
            importState: 'usable',
            coverage: 'UNKNOWN',
            coverageAfter: null,
            coverageThrough: null,
            collectionState: 'retired/active/granted',
            collectionStopped: true,
            lastLocalCommit: null,
            providerSuccessAt: null,
            discrepancyCount: 1,
          },
        ],
      },
    ],
    rows: [row()],
    ...overrides,
  },
});
const render = () =>
  root.render(
    <PersonalTransactions
      scope={scope}
      names={new Map([['account', 'Private checking']])}
    />,
  );
async function answer(value = report(), index = requests.length - 1) {
  await act(async () => requests[index].next(value));
}
async function click(label: string) {
  const target = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === label,
  )!;
  expect(target).toBeTruthy();
  await act(async () => target.click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  requests.length = 0;
  nav.search = 'tab=transactions';
  nav.push.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  host = document.createElement('div');
  document.body.append(host);
  window.scrollTo = vi.fn();
  window.requestAnimationFrame = (callback) =>
    window.setTimeout(() => callback(0), 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  scope = {
    id: 'alice',
    actor: 'alice',
    isLive: () => true,
    visits: new Map(),
    restored: new Set(),
    invalidate: vi.fn(),
    environment: queryEnvironment((request) => requests.push(request)),
  } as unknown as FinancialScope;
  root = relayRoot(createRoot(host), () => scope);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it('reads complete server counts and exact negative spending independently from one loaded row', async () => {
  await act(async () => render());
  await answer();
  expect(host.textContent).toContain('125 transactions');
  expect(host.textContent).toContain('−$40.00');
  expect(host.textContent).toContain('Partial coverage');
  expect(host.textContent).toContain('Classification incomplete');
  expect(
    host
      .querySelector('time[datetime="2026-10-17"]')
      ?.getAttribute('aria-label'),
  ).toBe('Posted bank date 2026-10-17');
  expect(host.textContent).not.toContain('Connect account');
  expect(
    host.querySelector('[data-source-id] a')?.getAttribute('href'),
  ).toContain('transaction=source-1');
});
it('appends only compatible pages and discards the traversal on concurrent changes', async () => {
  await act(async () => render());
  await answer();
  await click('Load more transactions');
  expect(requests[1].variables.after).toBe('signed');
  await answer(
    report({ id: 'page2', rows: [row('source-2')], hasNextPage: false }),
  );
  expect(host.querySelectorAll('[data-source-id]')).toHaveLength(2);
  nav.search = 'tab=transactions&activity=income';
  await act(async () => render());
  await answer();
  await click('Load more transactions');
  await answer(report({ code: 'RESTART_REQUIRED', rows: [], summary: null }));
  expect(host.querySelectorAll('[data-source-id]')).toHaveLength(0);
  expect(host.textContent).toContain('filters are preserved');
  await click('Restart activity');
  expect(requests.at(-1)?.variables).toMatchObject({
    filter: { activities: ['income'] },
  });
});
it('keeps custom/date and filter drafts separate until Apply and cancels safely', async () => {
  await act(async () => render());
  await answer();
  await click('This month');
  await click('Custom range');
  const dates = host.querySelectorAll<HTMLInputElement>('input[type=date]');
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!;
    set.call(dates[0], '2026-10-18');
    dates[0].dispatchEvent(new Event('input', { bubbles: true }));
    dates[0].dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('Cancel');
  expect(nav.push).not.toHaveBeenCalled();
  await click('Filters');
  await click('Reset filters');
  expect(nav.push).not.toHaveBeenCalled();
  await click('Apply filters');
  expect(nav.push).toHaveBeenCalledWith('/personal?tab=transactions', {
    scroll: false,
  });
});
it('uses source identity for selected current records outside archive date/activity filters', async () => {
  nav.search =
    'tab=transactions&transaction=current-source&period=last-month&activity=income';
  await act(async () => render());
  await answer(report({ rows: [], totalCount: 0, summary: null }));
  expect(requests.at(-1)?.name).toBe('personalTransactionSelectionQuery');
  expect(requests.at(-1)?.variables).toEqual({
    source: 'current-source',
    archive: null,
    discrepancy: false,
  });
  await answer({
    bankingTransaction: {
      id: 'detail',
      code: 'READY',
      currentId: 'current-source',
      transaction: row('current-source'),
    },
  } as unknown as ReturnType<typeof report>);
  expect(host.textContent).toContain('Private merchant');
  expect(
    host.querySelector('[data-source-id]')?.getAttribute('data-source-id'),
  ).toBe('current-source');
});
it('keeps immutable archive annotation provenance and links its sole current owner', async () => {
  nav.search = 'tab=transactions&archive=archive';
  await act(async () => render());
  await answer(report({ spendingContext: 'RECOVERY_ARCHIVE', summary: null }));
  expect(host.textContent).toContain('Recovery archive');
  expect(host.textContent).toContain('Original private note');
  expect(host.querySelector('a[id^=current]')?.getAttribute('href')).toBe(
    '/personal?tab=transactions&transaction=source-1',
  );
  expect(host.textContent).not.toContain('Spending from your accounts:');
});
it.each(['DATA_UNAVAILABLE', 'INVALID_INPUT', 'FORBIDDEN'])(
  'does not turn %s into successful empty or zero spending',
  async (code) => {
    await act(async () => render());
    await answer(report({ code, summary: null, counts: null, rows: [] }));
    expect(host.textContent).not.toContain('$0');
    expect(host.textContent).not.toContain('No matching transactions');
    expect(host.textContent).not.toContain('Private merchant');
  },
);
it('hides late responses after an actor switch', async () => {
  await act(async () => render());
  scope = {
    ...scope,
    id: 'bob',
    actor: 'bob',
    environment: queryEnvironment((request) => requests.push(request)),
  };
  await act(async () => render());
  await answer(report(), 0);
  expect(host.textContent).not.toContain('Private merchant');
});
it('reauthorizes a selected-row return before restoring a retained later-page row', async () => {
  await act(async () => render());
  await answer();
  await click('Load more transactions');
  await answer(report({ rows: [row('later-source')], hasNextPage: false }));
  nav.search = 'tab=transactions&transaction=later-source';
  await act(async () => render());
  expect(requests.at(-1)?.name).toBe('personalTransactionSelectionQuery');
  scope.visits.set('return-token', {
    href: '/personal?tab=transactions',
    focus: 'transaction-later-source',
    scroll: 100,
  });
  nav.search = 'tab=transactions&restore=return-token';
  await act(async () => render());
  expect(requests.at(-1)?.name).toBe('personalTransactionsQuery');
  expect(document.activeElement?.id).not.toBe('transaction-later-source');
  await answer();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  expect(document.activeElement?.id).toBe('transaction-later-source');
  expect(host.querySelectorAll('[data-source-id]')).toHaveLength(2);
});
it('keeps stale/reconnect import facts visible beside a usable complete current report', async () => {
  const facts = {
    operation: 'IDLE',
    importState: 'USABLE',
    usable: true,
    recovery: 'NONE',
    collection: 'RECONNECT_REQUIRED',
    reportingState: 'CURRENT',
    freshness: 'STALE',
    coverage: 'COMPLETE',
    historicalUpdate: 'COMPLETE',
    historyAvailability: 'UNKNOWN',
    discrepancyCount: '0',
  };
  await act(async () =>
    root.render(
      <PersonalTransactions
        scope={scope}
        names={new Map([['account', 'Private checking']])}
        statuses={new Map([['account', facts]])}
      />,
    ),
  );
  const account = report().bankingReport.accounts[0];
  await answer(
    report({
      accounts: [
        {
          ...account,
          coverage: 'COMPLETE',
          selected: true,
          transitionDate: null,
          intervals: [
            {
              ...account.intervals[0],
              throughDate: null,
              collectionState: 'current/active/granted',
              collectionStopped: false,
              importState: 'usable',
              coverage: 'COMPLETE',
              discrepancyCount: 0,
            },
          ],
        },
      ],
    }),
  );
  expect(host.textContent).toContain('Reconnect needed');
  expect(
    [...host.querySelectorAll('a')].some(
      (link) => link.textContent === 'View status in Connections',
    ),
  ).toBe(true);
  await act(async () =>
    root.render(
      <PersonalTransactions
        scope={scope}
        names={new Map([['account', 'Private checking']])}
        statuses={
          new Map([['account', { ...facts, collection: 'COLLECTING' }]])
        }
      />,
    ),
  );
  expect(host.textContent).toContain('updates are stale');
});

it('keeps the normal complete list compact with a whole-row target and no all-zero status block', async () => {
  await act(async () => render());
  await answer(
    report({
      counts: {
        count: 1,
        postedCount: 1,
        pendingCount: 0,
        removedCount: 0,
        excludedCount: 0,
        unresolvedCount: 0,
        reviewedCount: 1,
        classificationComplete: true,
      },
      summary: null,
      totalCount: 1,
      hasNextPage: false,
      rows: [{ ...row(), reviewed: true }],
      accounts: [
        {
          ...report().bankingReport.accounts[0],
          coverage: 'COMPLETE',
          intervals: [],
        },
      ],
    }),
  );
  const link = host.querySelector<HTMLAnchorElement>('#transaction-source-1')!;
  expect(link.textContent).toContain('Private merchant');
  expect(link.textContent).toContain('$100.00');
  expect(link.getAttribute('aria-describedby')).toContain(
    'row-source-1-context',
  );
  expect(host.textContent).not.toContain('0 pending');
  expect(host.textContent).not.toContain('0 unresolved');
  expect(host.textContent).not.toContain(
    'Activity context; no spending total applies.',
  );
});
