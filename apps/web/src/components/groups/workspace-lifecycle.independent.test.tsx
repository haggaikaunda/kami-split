// @vitest-environment jsdom
import { act } from 'react';
import {
  foregroundRefresh,
  pullRefresh,
} from '../workspace-refresh.test-utils';
import { createRoot, type Root } from 'react-dom/client';
import {
  Environment,
  Network,
  Observable,
  RecordSource,
  Store,
  type Variables,
} from 'relay-runtime';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FinancialScope } from '@/lib/relay/environment';
import { GroupJourney } from './journey';
import { HouseholdLedger } from '../expenses/household';
let search = 'tab=members',
  scope: FinancialScope;
vi.mock('./session', () => ({
  useFinancialSession: () => ({ scope, loading: false }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => '/groups/G',
  useRouter: () => ({
    push() {},
    replace(href: string) {
      search = href.split('?')[1] ?? '';
    },
  }),
}));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} aria-current={props['aria-current']}>
      {children}
    </a>
  ),
}));
let root: Root,
  host: HTMLDivElement,
  requests: {
    name: string;
    variables: Variables;
    canceled: boolean;
    next(data: unknown): void;
    fail(): void;
  }[];
const member = {
  id: 'M',
  displayName: 'Private member',
  role: 'OWNER',
  status: 'ACTIVE',
  canParticipate: true,
};
const group = {
  __typename: 'Group',
  id: 'G',
  name: 'Private group',
  currency: 'USD',
  kind: 'ORDINARY',
  isHousehold: false,
  trip: null,
  viewerMembership: member,
  members: [member],
};
const viewer = { __typename: 'Viewer', today: '2026-10-05' };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('CSS', { supports: () => true });
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
    'Chrome/140.0.0.0',
  );
  search = 'tab=members';
  requests = [];
  const environment = new Environment({
    network: Network.create((operation, variables) =>
      Observable.create((sink) => {
        const request = {
          name: operation.name,
          variables,
          canceled: false,
          fail() {
            sink.error(new Error('Offline'));
          },
          next(data: unknown) {
            sink.next({ data } as never);
          },
        };
        requests.push(request);
        return () => {
          request.canceled = true;
        };
      }),
    ),
    store: new Store(new RecordSource()),
  });
  scope = {
    id: 'test',
    actor: 'A',
    environment,
    isLive: () => true,
    visits: new Map(),
    restored: new Set(),
  } as FinancialScope;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('keeps the same public tab shell while destination changes cancel old requests without viewer discovery', async () => {
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  const shell = host.querySelector('.ui-workspace-tabs');
  expect(shell).not.toBeNull();
  expect(requests).toHaveLength(1);
  expect(requests[0].name).toBe('journeyWorkspaceQuery');
  await act(async () => requests[0].next({ viewer, group }));
  expect(host.textContent).toContain('Private member');
  search = 'tab=activity';
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  expect(host.querySelector('.ui-workspace-tabs')).toBe(shell);
  expect(host.textContent).not.toContain('Private member');
  expect(host.textContent).not.toContain('Private group');
  expect(requests).toHaveLength(2);
  expect(requests[0].canceled).toBe(true);
  expect(requests[1].variables).toMatchObject({
    activity: true,
    ledger: false,
    overview: false,
    balances: false,
    summary: false,
  });
  await act(async () => requests[0].next({ viewer, group }));
  expect(host.textContent).not.toContain('Private member');
  await act(async () =>
    requests[1].next({
      viewer,
      group: { __typename: 'Problem', code: 'NOT_FOUND', message: 'denied' },
      groupActivity: { __typename: 'Problem', code: 'NOT_FOUND' },
    }),
  );
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.textContent).not.toContain('Private group');
  expect(host.querySelector('.ui-workspace-tabs')).toBe(shell);
});
it('consumes the composed Activity result without a second dedicated read and coalesces foreground authorization', async () => {
  search = 'tab=activity';
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  await act(async () =>
    requests[0].next({
      viewer,
      group,
      groupActivity: {
        __typename: 'ActivityConnection',
        edges: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    }),
  );
  expect(host.textContent).toContain('No activity');
  expect(host.querySelectorAll('.workspace-refresh')).toHaveLength(1);
  expect(requests).toHaveLength(1);
  act(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
  });
  expect(host.textContent).not.toContain('Private group');
  expect(host.textContent).not.toContain('No activity');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(requests).toHaveLength(2);
  expect(requests[0].canceled).toBe(true);
});
it.each([
  [{ __typename: 'Problem', code: 'UNAUTHENTICATED' }, 'Sign in again'],
  [{ __typename: 'Problem', code: 'UNAVAILABLE' }, 'Refresh to try again'],
  [{ __typename: 'ViewerAccess', state: 'DISABLED' }, 'cannot access'],
  [{ __typename: 'ViewerAccess', state: 'UNPROVISIONED' }, 'cannot access'],
])(
  'attributes a successful group with failed viewer access to the account and retries safely (%j)',
  async (failedViewer, explanation) => {
    await act(async () => root.render(<GroupJourney initialGroup="G" />));
    await act(async () => requests[0].next({ viewer: failedViewer, group }));
    expect(host.querySelector('h1')?.textContent).toBe(
      'Account access unavailable',
    );
    expect(host.querySelector('[role=alert]')?.textContent).toContain(
      explanation,
    );
    expect(host.textContent).not.toContain('Private group');
    expect(host.textContent).not.toContain('Private member');
    expect(host.textContent).not.toContain('Settled');
    await foregroundRefresh();
    expect(host.querySelector('[role=alert]')).toBeNull();
    expect(requests).toHaveLength(2);
    expect(requests[1].variables.id).toBe('G');
    await act(async () => requests[1].next({ viewer, group }));
    expect(host.textContent).toContain('Private member');
    expect(host.textContent).not.toContain('Account access unavailable');
  },
);
it.each([
  ['expenses', 'groupExpenses', 'Expenses unavailable'],
  ['activity', 'groupActivity', 'Activity unavailable'],
])(
  'attributes %s composition failures without revealing successful group data',
  async (tab, field, heading) => {
    search = `tab=${tab}`;
    await act(async () => root.render(<GroupJourney initialGroup="G" />));
    await act(async () =>
      requests[0].next({
        viewer,
        group,
        [field]: {
          __typename: 'Problem',
          code: 'NOT_FOUND',
          message: 'sensitive server detail',
        },
      }),
    );
    expect(host.querySelector('h1')?.textContent).toBe(heading);
    expect(host.querySelector('[role=alert]')?.textContent).toContain(
      'cannot access',
    );
    expect(host.textContent).not.toContain('sensitive server detail');
    expect(host.textContent).not.toContain('Private group');
    expect(host.textContent).not.toContain('No activity');
    expect(host.textContent).not.toContain('No expenses');
  },
);
it('rapid Activity to Members to Activity navigation rejects out-of-order private responses', async () => {
  search = 'tab=activity';
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  const shell = host.querySelector('.ui-workspace-tabs');
  search = 'tab=members';
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  search = 'tab=activity';
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  expect(requests).toHaveLength(3);
  expect(requests.slice(0, 2).every((request) => request.canceled)).toBe(true);
  await act(async () =>
    requests[2].next({
      viewer,
      group: { __typename: 'Problem', code: 'NOT_FOUND', message: 'denied' },
      groupActivity: { __typename: 'Problem', code: 'NOT_FOUND' },
    }),
  );
  await act(async () => {
    requests[1].next({ viewer, group });
    requests[0].next({
      viewer,
      group,
      groupActivity: {
        __typename: 'ActivityConnection',
        edges: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });
  });
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.textContent).not.toContain('Private member');
  expect(host.textContent).not.toContain('Private group');
  expect(host.textContent).not.toContain('No activity');
  expect(host.querySelector('.ui-workspace-tabs')).toBe(shell);
  expect(
    host.querySelector('.ui-workspace-tabs a[aria-current="page"]')
      ?.textContent,
  ).toBe('Activity');
});
it('returning to the original expense filter reads fresh authorization instead of resurrecting its consumed initial result', async () => {
  const view = (amount: string) => ({
    __typename: 'ExpenseView',
    viewerShareMinor: '0',
    viewerPaidMinor: '0',
    categories: [],
    contextVersion: null,
    totalExpenseMinor: amount,
    expenseCount: '0',
    months: [],
    edges: [],
    pageInfo: { hasNextPage: false, endCursor: null },
  });
  search = 'tab=expenses&category=GROCERIES';
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  await act(async () =>
    requests[0].next({
      viewer,
      group: {
        ...group,
        balances: { __typename: 'Problem', code: 'UNAVAILABLE' },
      },
      groupExpenses: view('12345'),
    }),
  );
  expect(host.textContent).toContain('$123.45');
  expect(requests).toHaveLength(1);
  search = 'tab=expenses&category=TRANSPORT';
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  expect(requests).toHaveLength(2);
  expect(requests[1].name).toBe('expensesGroupQuery');
  await act(async () => requests[1].next({ groupExpenses: view('700') }));
  expect(host.textContent).toContain('$7.00');
  search = 'tab=expenses&category=GROCERIES';
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  expect(requests).toHaveLength(3);
  expect(host.textContent).not.toContain('$123.45');
  expect(host.textContent).not.toContain('$7.00');
  await act(async () =>
    requests[2].next({
      groupExpenses: { __typename: 'Problem', code: 'NOT_FOUND' },
    }),
  );
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.textContent).not.toContain('$123.45');
});
it('Household returning to the initial filter cannot revive previously authorized amounts after eligibility revocation', async () => {
  const view = (amount: string) => ({
    __typename: 'ExpenseView',
    viewerShareMinor: '0',
    viewerPaidMinor: '0',
    categories: [],
    contextVersion: 'eligible-v1',
    totalExpenseMinor: amount,
    expenseCount: '0',
    months: [],
    edges: [],
    pageInfo: { hasNextPage: false, endCursor: null },
  });
  search = 'category=GROCERIES';
  await act(async () => root.render(<HouseholdLedger scope={scope} />));
  await act(async () =>
    requests[0].next({
      viewer,
      householdDashboard: {
        __typename: 'HouseholdDashboard',
        state: 'COMPLETE',
        contextVersion: 'eligible-v1',
        totals: {
          __typename: 'HouseholdDashboardTotals',
          viewerShareMinor: '12345',
          viewerPaidMinor: '20000',
          viewerNetMinor: '0',
          activeSpaceCount: '1',
        },
        spaces: [],
      },
      householdExpenses: view('12345'),
    }),
  );
  expect(host.textContent).toContain('$123.45');
  expect(requests).toHaveLength(1);
  search = 'category=TRANSPORT';
  await act(async () => root.render(<HouseholdLedger scope={scope} />));
  expect(requests).toHaveLength(2);
  expect(requests[1].name).toBe('expensesHouseholdQuery');
  await act(async () => requests[1].next({ householdExpenses: view('700') }));
  expect(host.textContent).toContain('$7.00');
  search = 'category=GROCERIES';
  await act(async () => root.render(<HouseholdLedger scope={scope} />));
  expect(requests).toHaveLength(3);
  expect(host.textContent).not.toContain('$123.45');
  expect(host.textContent).not.toContain('$7.00');
  await act(async () =>
    requests[2].next({
      householdExpenses: { __typename: 'Problem', code: 'NOT_FOUND' },
    }),
  );
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.textContent).not.toContain('$123.45');
});

it('preserves selected Activity kind across manual and foreground authorization refreshes', async () => {
  search = 'tab=activity';
  const result = {
    viewer,
    group,
    groupActivity: {
      __typename: 'ActivityConnection',
      edges: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  await act(async () => requests[0].next(result));
  const filter =
    host.querySelector<HTMLSelectElement>('.activity-feed-filters select') ??
    host.querySelector<HTMLSelectElement>('select');
  expect(filter).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value',
    )!.set!.call(filter, 'REPAYMENT_RECORDED');
    filter!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(new URLSearchParams(search).get('activityKind')).toBe(
    'REPAYMENT_RECORDED',
  );
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  if (requests.length > 1) await act(async () => requests.at(-1)!.next(result));
  expect(host.querySelector<HTMLSelectElement>('select')!.value).toBe(
    'REPAYMENT_RECORDED',
  );
  const before = requests.length;
  await foregroundRefresh();
  expect(host.textContent).not.toContain('Private group');
  expect(requests).toHaveLength(before + 1);
  await act(async () => requests.at(-1)!.next(result));
  expect(requests.at(-1)!.name).toBe('activityGroupQuery');
  await act(async () =>
    requests.at(-1)!.next({ groupActivity: result.groupActivity }),
  );
  expect(host.querySelector<HTMLSelectElement>('select')!.value).toBe(
    'REPAYMENT_RECORDED',
  );
  act(() => window.dispatchEvent(new Event('focus')));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await act(async () => requests.at(-1)!.next(result));
  expect(requests.at(-1)!.name).toBe('activityGroupQuery');
  await act(async () =>
    requests.at(-1)!.next({ groupActivity: result.groupActivity }),
  );
  expect(host.querySelector<HTMLSelectElement>('select')!.value).toBe(
    'REPAYMENT_RECORDED',
  );
});

it('keeps filtered Activity refresh pending through its child read and exposes retry after transport failure', async () => {
  search = 'tab=activity&activityKind=REPAYMENT_RECORDED';
  const feed = {
    __typename: 'ActivityConnection',
    edges: [],
    pageInfo: { hasNextPage: false, endCursor: null },
  };
  const result = { viewer, group, groupActivity: feed };
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  await act(async () => requests[0].next(result));
  expect(requests[1].name).toBe('activityGroupQuery');
  await act(async () => requests[1].next({ groupActivity: feed }));
  const control = () => pullRefresh(host.querySelector('.workspace-refresh')!);
  const status = () =>
    host.querySelector('.workspace-refresh [role=status]')!.textContent;
  await act(async () => control());
  expect(requests[2].name).toBe('journeyWorkspaceQuery');
  await act(async () => requests[2].next(result));
  expect(requests[3].name).toBe('activityGroupQuery');
  expect(requests[3].variables.filter).toMatchObject({
    kind: 'REPAYMENT_RECORDED',
  });
  expect(host.querySelector('.workspace-refresh button')).toBeNull();
  expect(status()).toContain('Updating');
  expect(status()).not.toContain('Up to date');
  await act(async () => control());
  expect(requests).toHaveLength(4);
  await act(async () => requests[3].fail());
  expect(host.querySelector('.workspace-refresh button')).toBeNull();
  expect(status()).toContain('Try again');
  expect(status()).not.toContain('Up to date');
  await act(async () => control());
  expect(requests[4].name).toBe('journeyWorkspaceQuery');
  await act(async () => requests[4].next(result));
  expect(status()).toContain('Updating');
  expect(requests[5].name).toBe('activityGroupQuery');
  await act(async () => requests[5].next({ groupActivity: feed }));
  expect(status()).toContain('Up to date');
  expect(host.querySelector('.workspace-refresh button')).toBeNull();
});
