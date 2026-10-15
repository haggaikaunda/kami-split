// @vitest-environment jsdom
import { queryEnvironment, relayRoot } from '@/lib/relay/test-queries';
import { act } from 'react';
import { foregroundRefresh } from '../workspace-refresh.test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  HouseholdContent,
  HouseholdRead,
  householdHref,
  type Dashboard,
} from './household-workspace';
import { PeopleList, type Person } from '@/components/onboarding/people-list';
import type { FinancialScope } from '@/lib/relay/environment';
const queries = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('./overview-expense', () => ({
  OverviewExpense: ({ onCommitted }: { onCommitted: () => Promise<void> }) => (
    <button onClick={() => void onCommitted()}>Complete confirmed edit</button>
  ),
  OverviewExpenseLink: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock('@/components/onboarding/scoped-invitations', () => ({
  ScopedInvitations: ({
    group,
    members,
  }: {
    group: { id: string; name: string };
    members: readonly Person[];
  }) => (
    <>
      <PeopleList members={members} />
      <section data-invitation-group={group.id}>
        Invitations for {group.name}
      </section>
    </>
  ),
}));
vi.mock('relay-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('relay-runtime')>()),
  fetchQuery: (...args: unknown[]) => {
    const request = queries.fetch(...args) as { toPromise(): Promise<unknown> };
    return {
      subscribe(callbacks: {
        next(value: unknown): void;
        error(error: unknown): void;
      }) {
        let active = true;
        void request.toPromise().then(
          (value) => {
            if (active) callbacks.next(value);
          },
          (error) => {
            if (active) callbacks.error(error);
          },
        );
        return {
          unsubscribe() {
            active = false;
          },
        };
      },
    };
  },
}));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: 'a',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/household',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./navigation', () => ({
  ScopedLink: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
  RestoreSource: () => null,
}));
let root: Root, host: HTMLDivElement, live: boolean, scope: FinancialScope;
function fixture(net = '0'): Dashboard {
  return {
    __typename: 'HouseholdDashboard',
    state: 'COMPLETE',
    totals: {
      __typename: 'HouseholdDashboardTotals',
      viewerShareMinor: '12345',
      viewerPaidMinor: '20000',
      viewerNetMinor: net,
      openBalanceCount: '2',
      activeSpaceCount: '3',
      totalSharedExpenseMinor: '9007199254740993',
      totalSharedExpenseCount: '17',
    },
    spaces: [
      ['home/a', 'Home', '8420', true],
      ['trip-b', 'Maui', '-8420', false],
      ['group-c', 'Cabin', '0', false],
    ].map(([groupId, name, viewerNetMinor, isHousehold]) => ({
      groupId,
      name,
      viewerNetMinor,
      isHousehold,
      kind: groupId === 'trip-b' ? 'TRIP' : 'ORDINARY',
      currency: 'USD',
      sharedExpenseCount: '1',
      viewerMembership: { id: 'viewer', role: 'OWNER' },
      balances: {
        __typename: 'GroupBalances',
        settled: false,
        obligations: [],
      },
    })),
  } as unknown as Dashboard;
}
const result = (dashboard = fixture()) => ({
  householdDashboard: dashboard,
  householdExpenses: { __typename: 'ExpenseView', edges: [] },
});
function deferred() {
  let resolve!: (value: ReturnType<typeof result>) => void;
  const promise = new Promise<ReturnType<typeof result>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  queries.fetch.mockReset();
  live = true;
  scope = {
    environment: queryEnvironment((request) => {
      const response = queries.fetch(
        scope.environment,
        { params: { name: request.name } },
        request.variables,
        { fetchPolicy: 'network-only' },
      ) as { toPromise: () => Promise<unknown> };
      void response.toPromise().then(request.next, request.error);
    }),
    isLive: () => live,
  } as unknown as FinancialScope;
  host = document.createElement('div');
  document.body.append(host);
  root = relayRoot(createRoot(host), () => scope);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function content(
  current: 'Overview' | 'Balances' | 'Members',
  dashboard = fixture(),
  members?: Parameters<typeof HouseholdContent>[0]['members'],
) {
  await act(async () =>
    root.render(
      <HouseholdContent
        scope={scope}
        current={current}
        dashboard={dashboard}
        members={members}
        recent={{ __typename: 'ExpenseView', edges: [] }}
      />,
    ),
  );
}
it('renders exact server aggregates and zero net with open source balances without settlement controls', async () => {
  await content('Overview');
  const row = host.querySelector('[data-ui~="summary-row"]')!;
  expect(row.children).toHaveLength(3);
  expect(row.textContent).toContain('$90,071,992,547,409.93');
  expect(
    host.querySelector('[data-ui~="overview-count"]')?.textContent,
  ).toContain('17 expenses');
  expect(row.textContent).not.toContain('repayments excluded');
  expect(row.textContent).toContain('Payments still to settle');
  expect(row.textContent).not.toContain('Nothing to pay or collect');
  expect(row.querySelector('a')).toBeNull();
  expect(row.textContent).not.toContain('2 open balances');
  expect(host.querySelector('a[href="/household/expenses"]')).not.toBeNull();
  await content('Balances');
  expect(
    host.querySelectorAll('[data-ui~="household-balances"] li'),
  ).toHaveLength(3);
  expect(host.querySelectorAll('a[href*="repayments"]')).toHaveLength(0);
  expect(host.querySelectorAll('button[aria-haspopup=dialog]')).toHaveLength(1);
  expect(
    host.querySelectorAll('button:not([aria-haspopup=dialog])'),
  ).toHaveLength(0);
  expect(host.textContent).not.toContain('Settled');
  expect(
    host.querySelector('a[href="/household/ledger?tab=balances"]'),
  ).not.toBeNull();
  expect(
    host.querySelector('a[href="/trips/trip-b?tab=balances"]'),
  ).not.toBeNull();
  expect(
    host.querySelector('a[href="/groups/group-c?tab=balances"]'),
  ).not.toBeNull();
  expect(host.querySelector('a[href^="/groups/trip-b"]')).toBeNull();
  expect(host.textContent).toContain('+$84.20');
  expect(host.textContent).toContain('-$84.20');
});
it.each([
  ['150', "You're owed overall"],
  ['-150', 'You owe overall'],
])('gives %s textual direction', async (net, text) => {
  await content('Overview', fixture(net));
  expect(host.textContent).toContain(text);
});
it.each(['INCOMPLETE', 'UNAVAILABLE'] as const)(
  'does not present complete totals for %s',
  async (state) => {
    await content('Overview', { ...fixture(), state } as Dashboard);
    expect(host.querySelector('[data-ui~="summary-row"]')).toBeNull();
    expect(host.textContent).not.toContain('$0.00');
    if (state === 'UNAVAILABLE') {
      expect(host.textContent).toContain('Refresh to check current access');
      expect(host.textContent).not.toContain('not available yet');
      expect(host.querySelector('a[href="/household/ledger"]')).not.toBeNull();
    }
  },
);
it('uses real ledger membership beyond two people and only owner invitation management', async () => {
  const members = {
    __typename: 'Group',
    id: 'home/a',
    name: 'Real Household',
    viewerMembership: { role: 'OWNER' },
    members: ['Alice', 'Bob', 'Carol'].map((displayName) => ({
      id: displayName,
      displayName,
      role: 'MEMBER',
      status: 'ACTIVE',
    })),
  } as Parameters<typeof HouseholdContent>[0]['members'];
  await content('Members', fixture(), members);
  for (const name of ['Alice', 'Bob', 'Carol'])
    expect(host.textContent).toContain(name);
  expect(host.textContent).toContain(
    'Active Household members share this ledger',
  );
  expect(host.textContent).not.toContain('designated');
  expect(host.textContent).not.toContain('pair');
  expect(host.querySelectorAll('button[aria-haspopup=dialog]')).toHaveLength(0);
  expect(
    host.querySelectorAll('button:not([aria-haspopup=dialog])'),
  ).toHaveLength(0);
  expect(
    host.querySelector('[data-invitation-group="home/a"]')?.textContent,
  ).toBe('Invitations for Real Household');
  expect(host.querySelector('a[href="/invitations"]')).toBeNull();
  await content('Members', fixture(), {
    ...members!,
    viewerMembership: { role: 'MEMBER' },
  });
  expect(host.querySelector('[data-invitation-group]')).toBeNull();
  expect(householdHref('Activity')).toBe('/household/activity');
  expect(householdHref('Expenses')).toBe('/household/expenses');
});
it('clears private rows during refresh and rejects an older response', async () => {
  const first = deferred(),
    second = deferred(),
    third = deferred();
  for (const pending of [first, second, third])
    queries.fetch.mockReturnValueOnce({ toPromise: () => pending.promise });
  await act(async () =>
    root.render(<HouseholdRead scope={scope} current="Balances" />),
  );
  await act(async () => first.resolve(result()));
  expect(host.textContent).toContain('Maui');
  await foregroundRefresh();
  expect(host.textContent).not.toContain('Maui');
  await act(async () => window.dispatchEvent(new Event('focus')));
  await act(
    async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  await act(async () => second.resolve(result(fixture('999'))));
  expect(host.textContent).not.toContain('$9.99');
  await act(async () => third.resolve(result(fixture('123'))));
  expect(host.textContent).toContain('$1.23');
  expect(
    queries.fetch.mock.calls.every(
      (call) => call[3].fetchPolicy === 'network-only',
    ),
  ).toBe(true);
});
it('ignores disposed account scope and unmounted read completions', async () => {
  const pending = deferred();
  queries.fetch.mockReturnValue({ toPromise: () => pending.promise });
  await act(async () =>
    root.render(<HouseholdRead scope={scope} current="Balances" />),
  );
  live = false;
  await act(async () => pending.resolve(result()));
  expect(host.textContent).not.toContain('Maui');
  const unmounted = deferred();
  queries.fetch.mockReturnValue({ toPromise: () => unmounted.promise });
  live = true;
  await act(async () =>
    root.render(
      <HouseholdRead key="replacement" scope={scope} current="Balances" />,
    ),
  );
  await act(async () => root.render(<p>Other account</p>));
  await act(async () => unmounted.resolve(result()));
  expect(host.textContent).toBe('Other account');
});
it('reports rejected access without fabricated zeros or empty history', async () => {
  queries.fetch.mockReturnValue({
    toPromise: async () => ({
      householdDashboard: { __typename: 'Problem', code: 'FORBIDDEN' },
    }),
  });
  await act(async () =>
    root.render(<HouseholdRead scope={scope} current="Overview" />),
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'access is unavailable',
  );
  expect(host.textContent).not.toContain('$0.00');
  expect(host.textContent).not.toContain('No shared expenses yet');
});
it('rejects a member read for a different group and never renders its members', async () => {
  queries.fetch
    .mockReturnValueOnce({
      toPromise: async () => ({
        viewer: {
          __typename: 'Viewer',
          groups: [{ id: 'home/a', isHousehold: true }],
        },
      }),
    })
    .mockReturnValueOnce({
      toPromise: async () => ({
        group: {
          __typename: 'Group',
          id: 'other-group',
          members: [{ id: 'private', displayName: 'Wrong private member' }],
          viewerMembership: { role: 'OWNER' },
        },
      }),
    });
  await act(async () =>
    root.render(<HouseholdRead scope={scope} current="Members" />),
  );
  expect(queries.fetch.mock.calls[1][2]).toEqual({ id: 'home/a' });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'membership is unavailable',
  );
  expect(host.textContent).not.toContain('Wrong private member');
});
it('foreground refresh removes prior authorized content while a new read is pending', async () => {
  const pending = deferred();
  queries.fetch
    .mockReturnValueOnce({ toPromise: async () => result() })
    .mockReturnValueOnce({ toPromise: () => pending.promise });
  await act(async () =>
    root.render(<HouseholdRead scope={scope} current="Balances" />),
  );
  expect(host.textContent).toContain('Maui');
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible');
  await act(async () => window.dispatchEvent(new Event('focus')));
  await act(
    async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(host.textContent).not.toContain('Maui');
  expect(host.textContent).toContain('Loading Household');
  await act(async () => pending.resolve(result()));
  expect(host.textContent).toContain('Maui');
  visibility.mockRestore();
});

it('opens owner Household invitations using actual membership before aggregate readiness', async () => {
  queries.fetch
    .mockReturnValueOnce({
      toPromise: async () => ({
        viewer: {
          __typename: 'Viewer',
          groups: [
            { id: 'unrelated', isHousehold: false },
            { id: 'actual-household', isHousehold: true },
          ],
        },
      }),
    })
    .mockReturnValueOnce({
      toPromise: async () => ({
        group: {
          __typename: 'Group',
          id: 'actual-household',
          name: 'Our Household',
          viewerMembership: { role: 'OWNER' },
          members: [],
        },
      }),
    });
  await act(async () =>
    root.render(<HouseholdRead scope={scope} current="Members" />),
  );
  expect(queries.fetch.mock.calls.map((call) => call[1].params.name)).toEqual([
    'householdAccessQuery',
    'householdMembersQuery',
  ]);
  expect(queries.fetch.mock.calls[1][2]).toEqual({ id: 'actual-household' });
  expect(
    host.querySelector('[data-invitation-group="actual-household"]')
      ?.textContent,
  ).toBe('Invitations for Our Household');
  expect(host.querySelector('[data-invitation-group="unrelated"]')).toBeNull();
});
it('does not expose owner administration to an ordinary Household member without aggregate readiness', async () => {
  queries.fetch
    .mockReturnValueOnce({
      toPromise: async () => ({
        viewer: {
          __typename: 'Viewer',
          groups: [{ id: 'H', isHousehold: true }],
        },
      }),
    })
    .mockReturnValueOnce({
      toPromise: async () => ({
        group: {
          __typename: 'Group',
          id: 'H',
          name: 'Home',
          viewerMembership: { role: 'MEMBER' },
          members: [
            {
              id: 'M',
              displayName: 'Ordinary member',
              role: 'MEMBER',
              status: 'ACTIVE',
            },
          ],
        },
      }),
    });
  await act(async () =>
    root.render(<HouseholdRead scope={scope} current="Members" />),
  );
  expect(host.textContent).toContain('Ordinary member');
  expect(host.querySelector('[data-invitation-group]')).toBeNull();
  expect(queries.fetch.mock.calls.map((call) => call[1].params.name)).toEqual([
    'householdAccessQuery',
    'householdMembersQuery',
  ]);
});

it('shows one concise settled status without a duplicate open balance count', async () => {
  const dashboard = fixture();
  const totals = dashboard.totals!;
  await content('Overview', {
    ...dashboard,
    totals: { ...totals, openBalanceCount: '0' },
  } as Dashboard);
  const net = host.querySelector('[data-ui~="signed-balance"]')!;
  expect(net.textContent).toContain('Nothing to pay or collect');
  expect(net.textContent).not.toContain('0 open balances');
  expect(net.querySelector('a')).toBeNull();
});

it('keeps confirmed edit success distinct from a failed Household refresh without replaying the save', async () => {
  queries.fetch
    .mockReturnValueOnce({ toPromise: async () => result() })
    .mockReturnValueOnce({
      toPromise: async () => {
        throw new Error('refresh offline');
      },
    });
  await act(async () =>
    root.render(<HouseholdRead scope={scope} current="Overview" />),
  );
  expect(host.textContent).toContain('Maui');
  await act(async () =>
    Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent === 'Complete confirmed edit')!
      .click(),
  );
  expect(queries.fetch).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain('Expense edit saved.');
  expect(host.textContent).toContain(
    'unavailable data does not undo your edit.',
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'Household data is unavailable.',
  );
  expect(host.textContent).not.toContain('Maui');
  expect(host.textContent).not.toContain('Complete confirmed edit');
});

it('identifies aggregate and individual source scope without claiming unavailable sources are settled', async () => {
  await content('Overview');
  expect(host.textContent).not.toContain('currently eligible');
  expect(host.textContent).toContain('Home · Household expenses');
  expect(host.textContent).toContain('Maui · Trip');
  expect(host.textContent).toContain('Cabin · Group');
  const dashboard = fixture();
  await content('Balances', {
    ...dashboard,
    spaces: dashboard.spaces.map((space) => ({
      ...space,
      viewerNetMinor: '0',
      balances: { __typename: 'Problem', code: 'UNAVAILABLE' },
    })),
  } as Dashboard);
  expect(host.textContent).not.toContain('this space has open balances');
  expect(host.textContent).not.toContain('Settled');
  expect(
    host.querySelectorAll(
      '[data-ui~="household-balance"][data-position="unavailable"]',
    ),
  ).toHaveLength(3);
  await content('Balances', { ...dashboard, state: 'INCOMPLETE' } as Dashboard);
  expect(host.querySelector('[data-ui~="household-balances"]')).toBeNull();
  expect(host.textContent).not.toContain('Maui');
});

it('replaces eligible sources after revalidation rather than retaining a removed Trip', async () => {
  const dashboard = fixture();
  const totals = dashboard.totals;
  if (totals?.__typename !== 'HouseholdDashboardTotals')
    throw new Error('fixture');
  queries.fetch
    .mockReturnValueOnce({ toPromise: async () => result(dashboard) })
    .mockReturnValueOnce({
      toPromise: async () =>
        result({
          ...dashboard,
          totals: {
            ...totals,
            viewerNetMinor: '8420',
            activeSpaceCount: '2',
            openBalanceCount: '1',
          },
          spaces: dashboard.spaces.filter(
            (space) => space.groupId !== 'trip-b',
          ),
        }),
    });
  await act(async () =>
    root.render(<HouseholdRead scope={scope} current="Balances" />),
  );
  expect(
    host.querySelector('a[href="/trips/trip-b?tab=balances"]'),
  ).not.toBeNull();
  await foregroundRefresh();
  expect(host.textContent).not.toContain('Maui');
  expect(host.querySelector('a[href="/trips/trip-b?tab=balances"]')).toBeNull();
  expect(
    host.querySelectorAll('[data-ui~="household-balances"] li'),
  ).toHaveLength(2);
  expect(
    host.querySelector('[data-ui~="signed-balance"]')?.textContent,
  ).toContain('$84.20');
});

it.each(['INCOMPLETE', 'UNAVAILABLE', 'FORBIDDEN', 'NETWORK'])(
  'removes previous source details after a %s revalidation without claiming zero or settled',
  async (failure) => {
    queries.fetch
      .mockReturnValueOnce({ toPromise: async () => result() })
      .mockReturnValueOnce({
        toPromise: async () => {
          if (failure === 'NETWORK') throw new Error('offline');
          if (failure === 'FORBIDDEN')
            return {
              householdDashboard: { __typename: 'Problem', code: failure },
            };
          return result({ ...fixture(), state: failure } as Dashboard);
        },
      });
    await act(async () =>
      root.render(<HouseholdRead scope={scope} current="Balances" />),
    );
    expect(host.textContent).toContain('Maui');
    await foregroundRefresh();
    expect(host.textContent).not.toContain('Maui');
    expect(host.querySelector('[data-ui~="household-balances"]')).toBeNull();
    expect(host.querySelector('[data-ui~="signed-balance"]')).toBeNull();
    expect(host.textContent).not.toContain('$0.00');
    expect(host.textContent).not.toContain('Everyone in this space is settled');
    expect(host.textContent).not.toContain(
      'Your balance is zero in every eligible space',
    );
  },
);
