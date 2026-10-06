// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  HouseholdContent,
  HouseholdRead,
  householdHref,
  type Dashboard,
} from './household-workspace';
import type { FinancialScope } from '@/lib/relay/environment';
const queries = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('relay-runtime', () => ({
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
      kind: 'ORDINARY',
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
  scope = { environment: {}, isLive: () => live } as unknown as FinancialScope;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
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
  const row = host.querySelector('.ui-summary-row')!;
  expect(row.children).toHaveLength(3);
  expect(row.textContent).toContain('$90,071,992,547,409.93');
  expect(row.textContent).toContain('17 expenses · repayments excluded');
  expect(row.textContent).toContain('Overall net is zero');
  expect(row.textContent).toContain('2 open balances');
  expect(host.querySelector('a[href="/household/expenses"]')).not.toBeNull();
  await content('Balances');
  expect(host.querySelectorAll('.household-balances li')).toHaveLength(3);
  expect(host.querySelectorAll('a[href*="repayments"]')).toHaveLength(0);
  expect(host.querySelectorAll('button')).toHaveLength(0);
  expect(host.textContent).not.toContain('Settled');
  expect(
    host.querySelector('a[href="/groups/home%2Fa?tab=balances"]'),
  ).not.toBeNull();
  expect(host.textContent).toContain('+$84.20');
  expect(host.textContent).toContain('-$84.20');
});
it.each([
  ['150', "Overall, you're owed"],
  ['-150', 'Overall, you owe'],
])('gives %s textual direction', async (net, text) => {
  await content('Overview', fixture(net));
  expect(host.textContent).toContain(text);
});
it.each(['INCOMPLETE', 'UNAVAILABLE'] as const)(
  'does not present complete totals for %s',
  async (state) => {
    await content('Overview', { ...fixture(), state } as Dashboard);
    expect(host.querySelector('.ui-summary-row')).toBeNull();
    expect(host.textContent).not.toContain('$0.00');
    if (state === 'UNAVAILABLE') {
      expect(host.textContent).toContain('Refresh to check current access');
      expect(host.textContent).not.toContain('not available yet');
      expect(host.querySelector('a[href="/groups/home%2Fa"]')).not.toBeNull();
    }
  },
);
it('uses real ledger membership beyond two people and only owner invitation management', async () => {
  const members = {
    __typename: 'Group',
    id: 'home/a',
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
  expect(host.textContent).toContain('every active Household member');
  expect(host.textContent).not.toContain('designated');
  expect(host.textContent).not.toContain('pair');
  expect(host.querySelectorAll('button')).toHaveLength(0);
  expect(host.querySelector('a[href="/invitations"]')).not.toBeNull();
  await content('Members', fixture(), {
    ...members!,
    viewerMembership: { role: 'MEMBER' },
  });
  expect(host.querySelector('a[href="/invitations"]')).toBeNull();
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
  await act(async () => host.querySelector('button')!.click());
  expect(host.textContent).not.toContain('Maui');
  await act(async () => host.querySelector('button')!.click());
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
    .mockReturnValueOnce({ toPromise: async () => result() })
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
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    'Loading current authorized',
  );
  await act(async () => pending.resolve(result()));
  expect(host.textContent).toContain('Maui');
  visibility.mockRestore();
});
