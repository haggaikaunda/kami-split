// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { queryEnvironment, relayRoot } from '@/lib/relay/test-queries';
import type { FinancialScope } from '@/lib/relay/environment';
import { PersonalWorkspace } from './personal';
const session = vi.hoisted(() => ({
  scope: undefined as FinancialScope | undefined,
  loading: false,
  error: undefined as string | undefined,
}));
const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('../groups/session', () => ({ useFinancialSession: () => session }));
vi.mock('./reporting-timezone-control', () => ({
  ReportingTimezoneInitialization: ({
    showPeriod,
  }: {
    showPeriod: boolean;
  }) => <p data-timezone-period={showPeriod ? 'current' : 'omitted'} />,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/personal',
  useRouter: () => ({}),
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
type Request = {
  name: string;
  variables: Record<string, unknown>;
  next: (data: unknown) => void;
  error: (error?: Error) => void;
};
const requests: Request[] = [];
let root: Root, host: HTMLDivElement;
const status = {
  operation: 'IDLE',
  importState: 'USABLE',
  usable: true,
  recovery: 'NONE',
  collection: 'COLLECTING',
  reportingState: 'CURRENT',
  freshness: 'OBSERVED',
  coverage: 'UNKNOWN',
  historyAvailability: 'unknown',
  historicalUpdate: 'COMPLETE',
  lastLocalCommit: '2026-10-20T11:00:00Z',
  providerSuccessAt: null,
  discrepancyCount: '0',
};
const connection = {
  id: 'c1',
  state: 'active',
  health: 'healthy',
  cleanup: 'not_requested',
  purge: 'not_requested',
  accounts: [
    {
      id: 'a1',
      streamId: 's1',
      name: 'Sensitive long private checking account',
      kind: 'checking',
      currency: 'USD',
      selected: true,
      requestedHistoryDays: 365,
      importStatus: status,
    },
  ],
};
const inventory = (connections: unknown[] = [], code = 'READY') => ({
  bankingConnections: {
    __typename: 'BankingConnectionsResult',
    code,
    connections,
    endCursor: null,
    hasNextPage: false,
  },
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  requests.length = 0;
  nav.search = '';
  session.loading = false;
  session.error = undefined;
  host = document.createElement('div');
  document.body.append(host);
  window.requestAnimationFrame = (callback) =>
    window.setTimeout(() => callback(performance.now()), 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.scrollTo = vi.fn();
  session.scope = {
    id: 'alice',
    actor: 'alice',
    isLive: () => true,
    visits: new Map(),
    restored: new Set(),
    invalidate: vi.fn(),
    environment: queryEnvironment((request) => requests.push(request)),
  } as unknown as FinancialScope;
  root = relayRoot(createRoot(host), () => session.scope);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it('defaults to This month Overview and routes first use to Connections without a connect control or fake total', async () => {
  await act(async () => root.render(<PersonalWorkspace />));
  expect(host.textContent).not.toContain('Sensitive');
  expect(host.querySelector('button')).toBeNull();
  await act(async () => requests[0].next(inventory()));
  expect(host.textContent).toContain('This month');
  expect(
    host
      .querySelector('[data-timezone-period]')
      ?.getAttribute('data-timezone-period'),
  ).toBe('current');
  expect(host.textContent).toContain('Spending from your accounts');
  expect(host.querySelector('a')?.getAttribute('href')).toBe(
    '/personal?tab=connections',
  );
  expect(host.textContent).not.toContain('Connect account');
  expect(host.textContent).not.toContain('$0');
});
it('preserves applied Personal URL state while routing Transactions to setup', async () => {
  nav.search = 'tab=transactions&period=last-month&account=private-id';
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () => requests[0].next(inventory()));
  expect(host.querySelector('a')?.getAttribute('href')).toBe(
    '/personal?tab=connections&period=last-month&account=private-id',
  );
  expect(host.textContent).not.toContain('Connect account');
  expect(host.textContent).not.toContain('This month');
  expect(
    host
      .querySelector('[data-timezone-period]')
      ?.getAttribute('data-timezone-period'),
  ).toBe('omitted');
});
it('shows a known empty Connections state only after fresh owner authorization', async () => {
  nav.search = 'tab=connections';
  await act(async () => root.render(<PersonalWorkspace />));
  expect(host.textContent).not.toContain('Connect account');
  await act(async () => requests[0].next(inventory()));
  expect(host.textContent).toContain('No connected accounts yet');
  expect(host.textContent).toContain('Connect account');
});
it('does not turn domain access failure into first-use enrollment or successful empty history', async () => {
  nav.search = 'tab=connections';
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () => requests[0].next(inventory([], 'FORBIDDEN')));
  expect(host.textContent).toContain('unavailable');
  expect(host.textContent).not.toContain('Connect account');
  expect(host.textContent).not.toContain('No connected accounts');
});
it('keeps import, freshness and history coverage distinct and avoids invented institution metadata', async () => {
  nav.search = 'tab=connections';
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () => requests[0].next(inventory([connection])));
  expect(host.textContent).toContain('Sensitive long');
  expect(host.textContent).toContain('Included');
  expect(host.textContent).toContain('coverage is unknown');
  expect(host.textContent).toContain('Bank success observationUnknown');
  expect(host.textContent).not.toContain('All up to date');
  expect(host.textContent).not.toContain('ending ');
});
it('clears prior account details on foreground invalidation before the replacement read', async () => {
  nav.search = 'tab=connections';
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () => requests[0].next(inventory([connection])));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(host.textContent).not.toContain('Sensitive long');
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(requests).toHaveLength(2);
  await act(async () => requests[1].next(inventory([], 'UNAVAILABLE')));
  expect(host.textContent).not.toContain('Sensitive long');
  expect(host.textContent).not.toContain('No connected accounts');
});
it('isolates a late inventory response after actor switch and hides details while checking authentication', async () => {
  nav.search = 'tab=connections';
  await act(async () => root.render(<PersonalWorkspace />));
  session.scope = {
    ...session.scope!,
    id: 'bob',
    actor: 'bob',
    environment: queryEnvironment((request) => requests.push(request)),
  };
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () => requests[0].next(inventory([connection])));
  expect(host.textContent).not.toContain('Sensitive long');
  await act(async () => requests[1].next(inventory([connection])));
  session.loading = true;
  await act(async () => root.render(<PersonalWorkspace />));
  expect(host.textContent).not.toContain('Sensitive long');
});

it('leads existing Connections with the compact heading and leaves setup details undisclosed', async () => {
  nav.search = 'tab=connections';
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () => requests[0].next(inventory([connection])));
  expect(host.querySelector('#connection-setup')).toBeNull();
  const title = host.querySelector('#connections-heading')!;
  const account = host.querySelector('article')!;
  expect(
    title.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(host.querySelector('article')?.textContent).toContain(
    'Sensitive long',
  );
  expect(
    host.querySelector('#existing-connections > p')?.textContent,
  ).toContain('Only selected accounts');
});

it.each(['overview', 'transactions'])(
  'shows the owner-only privacy notice on first-use %s',
  async (section) => {
    nav.search = `tab=${section}`;
    await act(async () => root.render(<PersonalWorkspace />));
    await act(async () => requests[0].next(inventory()));
    expect(host.textContent).toContain(
      'Only you can see these bank accounts and their activity.',
    );
    expect(host.textContent).not.toContain('Connect account');
  },
);
function transactionReportAccounts(ids: string[]) {
  return {
    bankingReport: {
      id: 'report-inventory-boundary',
      code: 'READY',
      fieldErrors: [],
      start: '2026-10-01',
      end: '2026-10-17',
      asOfDate: '2026-10-17',
      timezone: 'America/Los_Angeles',
      revision: 'report-revision',
      totalCount: 0,
      spendingContext: 'ACTIVITY_CONTEXT',
      endCursor: null,
      hasNextPage: false,
      activityChoices: ['purchase', 'transfer', 'income'],
      categoryChoices: ['UNCATEGORIZED'],
      summary: null,
      counts: {
        count: 0,
        postedCount: 0,
        pendingCount: 0,
        removedCount: 0,
        excludedCount: 0,
        unresolvedCount: 0,
        reviewedCount: 0,
        classificationComplete: true,
      },
      rows: [],
      accounts: ids.map((accountId) => ({
        id: `snapshot-${accountId}`,
        accountId,
        kind: 'checking',
        selected: true,
        coverage: 'COMPLETE',
        planId: null,
        transitionDate: null,
        archives: [],
        intervals: [
          {
            bindingId: `binding-${accountId}`,
            afterDate: null,
            throughDate: null,
            importState: 'usable',
            coverage: 'COMPLETE',
            coverageAfter: '2026-09-30',
            coverageThrough: '2026-10-17',
            collectionState: 'current/active/granted',
            collectionStopped: false,
            lastLocalCommit: null,
            providerSuccessAt: null,
            discrepancyCount: 0,
          },
        ],
      })),
    },
  };
}
const pagedInventory = () => ({
  bankingConnections: {
    ...inventory([connection]).bankingConnections,
    hasNextPage: true,
    endCursor: 'next-connections',
  },
});
it('loads later inventory pages for distinct current-account labels and independent stale/reconnect status', async () => {
  nav.search = 'tab=transactions';
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () => requests[0].next(pagedInventory()));
  expect(requests[1].name).toBe('personalInventoryQuery');
  expect(requests[1].variables).toEqual({
    first: 20,
    after: 'next-connections',
  });
  const accounts = [
    {
      ...connection.accounts[0],
      id: 'later-one',
      streamId: 'later-stream-one',
      name: 'Distinct later checking one',
      importStatus: { ...status, collection: 'RECONNECT_REQUIRED' },
    },
    {
      ...connection.accounts[0],
      id: 'later-two',
      streamId: 'later-stream-two',
      name: 'Distinct later checking two',
      importStatus: { ...status, freshness: 'STALE' },
    },
  ];
  await act(async () =>
    requests[1].next(
      inventory([{ ...connection, id: 'later-connection', accounts }]),
    ),
  );
  expect(requests[2].name).toBe('personalTransactionsQuery');
  await act(async () =>
    requests[2].next(transactionReportAccounts(['later-one', 'later-two'])),
  );
  expect(host.textContent).toContain('Distinct later checking one');
  expect(host.textContent).toContain('Distinct later checking two');
  expect(host.textContent).toContain('Reconnect needed');
  expect(host.textContent).toContain('updates are stale');
  expect(
    [...host.querySelectorAll('a')].some(
      (link) => link.textContent === 'View status in Connections',
    ),
  ).toBe(true);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((button) => button.textContent === 'Filters')!
      .click(),
  );
  expect(
    [...host.querySelectorAll('select option')].map(
      (option) => option.textContent,
    ),
  ).toEqual(
    expect.arrayContaining([
      'Distinct later checking one',
      'Distinct later checking two',
    ]),
  );
});
it('does not fabricate current metadata or start a report after an inventory continuation denial', async () => {
  nav.search = 'tab=transactions';
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () => requests[0].next(pagedInventory()));
  await act(async () => requests[1].next(inventory([], 'FORBIDDEN')));
  expect(host.textContent).toContain('Private accounts are unavailable');
  expect(
    requests.some((request) => request.name === 'personalTransactionsQuery'),
  ).toBe(false);
  expect(host.textContent).not.toContain('Sensitive long');
});
it('offers a bounded metadata retry after transport failure without rendering an incomplete report', async () => {
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    nav.search = 'tab=transactions';
    await act(async () => root.render(<PersonalWorkspace />));
    await act(async () => requests[0].next(pagedInventory()));
    await act(async () =>
      requests[1].error(new Error('synthetic transport failure')),
    );
    expect(host.textContent).toContain(
      'Account identities could not be loaded',
    );
    expect(
      requests.some((request) => request.name === 'personalTransactionsQuery'),
    ).toBe(false);
    await act(async () =>
      [...host.querySelectorAll('button')]
        .find((button) => button.textContent === 'Retry account identities')!
        .click(),
    );
    expect(requests[2].variables).toEqual({
      first: 20,
      after: 'next-connections',
    });
  } finally {
    diagnostic.mockRestore();
  }
});
it('disposes a pending inventory continuation before a late actor response can reveal account labels', async () => {
  nav.search = 'tab=transactions';
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () => requests[0].next(pagedInventory()));
  session.scope = {
    ...session.scope!,
    id: 'bob',
    actor: 'bob',
    environment: queryEnvironment((request) => requests.push(request)),
  };
  await act(async () => root.render(<PersonalWorkspace />));
  await act(async () =>
    requests[1].next(
      inventory([
        {
          ...connection,
          accounts: [
            { ...connection.accounts[0], name: 'Foreign later private name' },
          ],
        },
      ]),
    ),
  );
  expect(host.textContent).not.toContain('Foreign later private name');
  expect(
    requests.some((request) => request.name === 'personalTransactionsQuery'),
  ).toBe(false);
});
