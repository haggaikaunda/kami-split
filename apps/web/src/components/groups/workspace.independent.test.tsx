// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroupWorkspace, type WorkspaceGroup } from './workspace';
const nav = vi.hoisted(() => ({ search: '', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('./navigation', () => ({
  ScopedLink: ({
    children,
    href,
    id,
  }: {
    children: React.ReactNode;
    href: string;
    id: string;
  }) => (
    <a href={href} id={id}>
      {children}
    </a>
  ),
}));
let root: Root, host: HTMLDivElement;
const member = (id: string, displayName: string) => ({
  id,
  displayName,
  status: 'ACTIVE' as const,
  role: 'MEMBER' as const,
  canParticipate: true,
});
const a = member('a', 'Alice'),
  b = member('b', 'Bob'),
  c = member('c', 'Carol');
function fixture(net: string, trip = false): WorkspaceGroup {
  return {
    __typename: 'Group',
    id: 'G',
    name: 'Shared space',
    currency: 'USD',
    kind: trip ? 'TRIP' : 'ORDINARY',
    isHousehold: false,
    trip: trip
      ? { destination: 'Rome', startDate: '2026-10-01', endDate: '2026-10-05' }
      : null,
    viewerMembership: a,
    members: [a, b, c],
    balances: {
      __typename: 'GroupBalances',
      groupId: 'G',
      totalExpenseMinor: '9007199254740993',
      settled: false,
      positions: [a, b, c].map((member, i) => ({
        member,
        netMinor: i ? '500' : net,
        paidMinor: '0',
        owedMinor: '0',
        sentMinor: '0',
        receivedMinor: '0',
      })),
      obligations: [
        { from: a, to: b, amountMinor: '401' },
        { from: a, to: c, amountMinor: '599' },
      ],
    },
    expenses: {
      edges: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null },
    },
    repayments: {
      edges: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  } as unknown as WorkspaceGroup;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  nav.search = '';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function render(group: WorkspaceGroup) {
  await act(async () =>
    root.render(
      <GroupWorkspace
        scope={{} as never}
        group={group}
        today="2026-10-04"
        onRefresh={async () => {}}
        onCommitted={async () => {}}
        onDenied={() => {}}
      />,
    ),
  );
}
it('uses the same five shared workspace tabs for ordinary groups and trips, with informational exact summary metrics', async () => {
  for (const trip of [false, true]) {
    await render(fixture('-1000', trip));
    expect(
      [...host.querySelectorAll('.ui-workspace-tabs a')].map(
        (a) => a.textContent,
      ),
    ).toEqual(['Overview', 'Expenses', 'Balances', 'Activity', 'Members']);
    const summaries = host.querySelector('.ui-summary-row')!;
    expect(summaries.children).toHaveLength(2);
    expect(summaries.textContent).toContain('90,071,992,547,409.93');
    expect(summaries.textContent).toContain('You owe');
    expect(summaries.querySelectorAll('a')).toHaveLength(1);
    expect(summaries.querySelector('a')!.textContent).toBe('View balance');
    expect(host.querySelector('#recent-expenses-title')).not.toBeNull();
    expect(
      [...host.querySelectorAll('.ui-workspace-tabs a')].map((a) =>
        a.getAttribute('href'),
      ),
    ).toEqual(
      ['overview', 'expenses', 'balances', 'activity', 'members'].map(
        (tab) => `${trip ? '/trips' : '/groups'}/G?tab=${tab}`,
      ),
    );
  }
});
it('exposes every one-to-many obligation with exact group, sender, recipient and cents, only in balance details', async () => {
  nav.search = 'tab=balances';
  await render(fixture('-1000'));
  const links = [...host.querySelectorAll('a[href*="repayments/new"]')];
  expect(links).toHaveLength(2);
  expect(links.map((a) => a.getAttribute('href'))).toEqual([
    '/groups/G/repayments/new?sender=a&recipient=b&amount=401',
    '/groups/G/repayments/new?sender=a&recipient=c&amount=599',
  ]);
  expect(host.textContent).toContain('4.01');
  expect(host.textContent).toContain('5.99');
  expect(host.textContent).toContain('Bob');
  expect(host.textContent).toContain('Carol');
});
it('states positive means owed and distinguishes zero viewer from unsettled group', async () => {
  await render(fixture('1000'));
  expect(host.querySelector('.ui-summary-row')!.textContent).toContain(
    "You're owed",
  );
  await render(fixture('0'));
  expect(host.textContent).toContain(
    'Other members still have open obligations',
  );
  nav.search = 'tab=balances';
  await render(fixture('0'));
  expect(host.textContent).toContain('This group has outstanding balances');
  expect(host.querySelectorAll('a[href*="repayments/new"]')).toHaveLength(2);
});
