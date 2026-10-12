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
    expect(summaries.children).toHaveLength(3);
    expect(summaries.textContent).toContain('90,071,992,547,409.93');
    expect(summaries.textContent).toContain('You owe');
    expect(summaries.querySelectorAll('a')).toHaveLength(0);
    expect(
      host
        .querySelector('.workspace-overview-balances a')
        ?.getAttribute('href'),
    ).toBe(`${trip ? '/trips' : '/groups'}/G?tab=balances`);
    expect(host.querySelector('.banner-action')?.getAttribute('href')).toBe(
      `${trip ? '/trips' : '/groups'}/G?tab=expenses&create=G`,
    );
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

it('shows complete viewer expense allocations and payer amount without deriving either from repayment-adjusted net', async () => {
  const group = fixture('0');
  const balances = group.balances;
  if (balances?.__typename !== 'GroupBalances') throw new Error('fixture');
  const updated = {
    ...group,
    balances: {
      ...balances,
      positions: balances.positions.map((position, i) =>
        i
          ? position
          : {
              ...position,
              paidMinor: '9007199254740993',
              owedMinor: '375',
              sentMinor: '800',
              receivedMinor: '1200',
            },
      ),
    },
  };
  await render(updated);
  const summary = host.querySelector('.ui-summary-row')!;
  expect(
    [...summary.querySelectorAll('.ui-metric-label')].map((n) => n.textContent),
  ).toEqual(['Total expenses', 'Your net balance', 'Your share']);
  expect(summary.textContent).toContain('3.75');
  expect(summary.textContent).toContain('You paid $90,071,992,547,409.93 USD');
  expect(summary.textContent).toContain(
    'Other members still have open obligations',
  );
});

it('explains authoritative expense and repayment contributions with exact displayed amounts', async () => {
  nav.search = 'tab=balances';
  const group = fixture('2500');
  if (group.balances?.__typename !== 'GroupBalances')
    throw new Error('fixture');
  await render({
    ...group,
    isHousehold: true,
    balances: {
      ...group.balances,
      positions: [
        {
          member: a,
          paidMinor: '6000',
          owedMinor: '2000',
          sentMinor: '0',
          receivedMinor: '1500',
          netMinor: '2500',
        },
        {
          member: b,
          paidMinor: '0',
          owedMinor: '2000',
          sentMinor: '500',
          receivedMinor: '0',
          netMinor: '-1500',
        },
        {
          member: c,
          paidMinor: '0',
          owedMinor: '2000',
          sentMinor: '1000',
          receivedMinor: '0',
          netMinor: '-1000',
        },
      ],
    },
  });
  expect(host.textContent).toContain('Household source ledger');
  expect(host.textContent).toContain('Who owes whom');
  expect(host.textContent).toContain(
    'Repayments do not change expense totals or shares',
  );
  const calculations = [
    ...host.querySelectorAll('[aria-label^="Balance calculation"]'),
  ].map((node) => node.textContent?.replace(/\s+/g, ' '));
  expect(calculations).toEqual([
    '$60.00 − $20.00 + $0.00 − $15.00 = $25.00 USD',
    '$0.00 − $20.00 + $5.00 − $0.00 = -$15.00 USD',
    '$0.00 − $20.00 + $10.00 − $0.00 = -$10.00 USD',
  ]);
  expect(
    host.querySelector(
      '.group-balances a[href="/household/ledger?tab=activity"]',
    )?.textContent,
  ).toContain('before/after history');
});

it('distinguishes a fully repaid viewer from outstanding obligations between other members', async () => {
  nav.search = 'tab=balances';
  const group = fixture('0');
  if (group.balances?.__typename !== 'GroupBalances')
    throw new Error('fixture');
  const balances = {
    ...group.balances,
    totalExpenseMinor: '6000',
    settled: false,
    positions: [
      {
        member: a,
        paidMinor: '6000',
        owedMinor: '2000',
        sentMinor: '0',
        receivedMinor: '4000',
        netMinor: '0',
      },
      {
        member: b,
        paidMinor: '0',
        owedMinor: '2000',
        sentMinor: '3000',
        receivedMinor: '0',
        netMinor: '1000',
      },
      {
        member: c,
        paidMinor: '0',
        owedMinor: '2000',
        sentMinor: '1000',
        receivedMinor: '0',
        netMinor: '-1000',
      },
    ],
    obligations: [{ from: c, to: b, amountMinor: '1000' }],
  };
  await render({ ...group, balances });
  expect(host.textContent).toContain(
    'Your balance is zero. Other members still have open obligations.',
  );
  expect(host.textContent).not.toContain('Everyone in this space is settled');
  expect(
    host.querySelector('[aria-label="Balance calculation for Alice"]')
      ?.textContent,
  ).toContain('$60.00 − $20.00 + $0.00 − $40.00 = $0.00 USD');
  expect(
    [...host.querySelectorAll('a[href*="repayments/new"]')].map((node) =>
      node.getAttribute('href'),
    ),
  ).toEqual(['/groups/G/repayments/new?sender=c&recipient=b&amount=1000']);
  await render({
    ...group,
    balances: {
      ...balances,
      settled: true,
      positions: balances.positions.map((position) => ({
        ...position,
        sentMinor: position.member.id === 'c' ? '2000' : position.sentMinor,
        receivedMinor:
          position.member.id === 'b' ? '1000' : position.receivedMinor,
        netMinor: '0',
      })),
      obligations: [],
    },
  });
  expect(host.textContent).toContain(
    'Everyone in this space is settled: each member’s balance is zero.',
  );
  expect(host.textContent).toContain('No repayments are needed in this space.');
  expect(host.querySelector('a[href*="repayments/new"]')).toBeNull();
  await render({
    ...group,
    balances: { __typename: 'Problem', code: 'UNAVAILABLE' },
  } as unknown as WorkspaceGroup);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'Balances are unavailable',
  );
  expect(host.querySelector('.balance-position')).toBeNull();
  expect(host.textContent).not.toContain('Everyone in this space is settled');
  expect(host.textContent).not.toContain('$0.00');
});
