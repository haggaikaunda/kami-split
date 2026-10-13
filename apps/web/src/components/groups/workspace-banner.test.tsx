// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { GroupWorkspace, type WorkspaceGroup } from './workspace';
const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('next/link', () => ({
  default: 'a',
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock('@/components/expenses/ledger', () => ({
  ExpenseLedger: () => <section>Expense list</section>,
}));
vi.mock('@/components/activity/feed', () => ({
  ActivityFeed: () => <section>Activity history</section>,
}));
vi.mock('./overview-expense', () => ({ OverviewExpense: () => null }));
vi.mock('./navigation', () => ({ ScopedLink: 'a' }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function group(trip: boolean): WorkspaceGroup {
  const member = {
    id: 'viewer',
    displayName: 'Viewer',
    status: 'ACTIVE',
    role: 'MEMBER',
    canParticipate: true,
  };
  return {
    __typename: 'Group',
    id: 'g/a',
    name: trip ? 'Long holiday trip name' : 'Long shared group name',
    kind: trip ? 'TRIP' : 'ORDINARY',
    isHousehold: false,
    currency: 'USD',
    trip: trip
      ? { destination: 'Rome', startDate: '2026-10-01', endDate: '2026-10-05' }
      : null,
    members: [member],
    viewerMembership: member,
    balances: {
      __typename: 'GroupBalances',
      settled: true,
      totalExpenseMinor: '0',
      positions: [
        {
          member,
          netMinor: '0',
          paidMinor: '0',
          owedMinor: '0',
          sentMinor: '0',
          receivedMinor: '0',
        },
      ],
      obligations: [],
    },
    expenses: { edges: [] },
    repayments: { edges: [] },
  } as unknown as WorkspaceGroup;
}
it('retains the artwork banner and one labeled Add expense destination on every Group and Trip tab', () => {
  for (const trip of [false, true]) {
    const fixture = group(trip);
    for (const tab of [
      'overview',
      'expenses',
      'balances',
      'activity',
      'members',
    ]) {
      nav.search = `tab=${tab}&category=FOOD&sort=oldest&view=breakdown`;
      act(() =>
        root.render(
          <GroupWorkspace
            scope={{} as never}
            group={fixture}
            today="2026-10-04"
            onRefresh={async () => {}}
            onCommitted={async () => {}}
            onDenied={() => {}}
          />,
        ),
      );
      const header = host.querySelector('header')!;
      expect(
        header
          .getAttribute('data-ui')
          ?.split(/\s+/)
          .includes(`workspace-header--${trip ? 'trip' : 'group'}`),
      ).toBe(true);
      expect(
        header
          .getAttribute('data-ui')
          ?.split(/\s+/)
          .includes('workspace-header--compact'),
      ).toBe(false);
      expect(header.querySelector('h1')?.textContent).toBe(fixture.name);
      expect(host.querySelectorAll('[data-ui~="banner-action"]')).toHaveLength(
        1,
      );
      const href = header
        .querySelector('[data-ui~="banner-action"]')!
        .getAttribute('href')!;
      const url = new URL(href, 'http://localhost');
      expect(url.pathname).toBe(`/${trip ? 'trips' : 'groups'}/g%2Fa`);
      expect(url.searchParams.get('create')).toBe('g/a');
      if (tab === 'expenses') {
        expect(url.searchParams.get('category')).toBe('FOOD');
        expect(url.searchParams.get('sort')).toBe('oldest');
        expect(url.searchParams.get('view')).toBe('breakdown');
      }
    }
  }
});

it('identifies the original Household-only source on Overview, Expenses and Balances', () => {
  for (const tab of ['overview', 'expenses', 'balances']) {
    nav.search = `tab=${tab}`;
    act(() =>
      root.render(
        <GroupWorkspace
          scope={{} as never}
          group={{ ...group(false), isHousehold: true }}
          today="2026-10-04"
          showHeader={false}
          onRefresh={async () => {}}
          onCommitted={async () => {}}
          onDenied={() => {}}
        />,
      ),
    );
    expect(host.textContent).toContain('Household expenses');
    expect(host.textContent).not.toContain('Household source ledger');
  }
});
