// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  Environment,
  Network,
  Observable,
  RecordSource,
  Store,
} from 'relay-runtime';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HouseholdRead } from './household-workspace';
import type { FinancialScope } from '@/lib/relay/environment';
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: 'a',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
let root: Root, host: HTMLDivElement, scope: FinancialScope;
let requests: { name: string; canceled: boolean; next(data: unknown): void }[];
const dashboard = {
  __typename: 'HouseholdDashboard',
  state: 'COMPLETE',
  totals: {
    __typename: 'HouseholdDashboardTotals',
    viewerShareMinor: '12345',
    viewerPaidMinor: '20000',
    viewerNetMinor: '800',
    openBalanceCount: '1',
    activeSpaceCount: '1',
    totalSharedExpenseMinor: '800',
    totalSharedExpenseCount: '1',
  },
  spaces: [
    {
      groupId: 'H',
      name: 'Private Home',
      kind: 'ORDINARY',
      isHousehold: true,
      currency: 'USD',
      viewerNetMinor: '800',
      sharedExpenseCount: '1',
      viewerMembership: { id: 'M', role: 'OWNER' },
      balances: {
        __typename: 'GroupBalances',
        settled: false,
        obligations: [],
      },
    },
  ],
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  requests = [];
  const environment = new Environment({
    network: Network.create((operation) =>
      Observable.create((sink) => {
        const request = {
          name: operation.name,
          canceled: false,
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
});
it('refresh cancels the actual Relay request and denies access despite a late prior authorized response', async () => {
  await act(async () =>
    root.render(<HouseholdRead scope={scope} current="Balances" />),
  );
  expect(requests).toHaveLength(1);
  act(() => window.dispatchEvent(new Event('focus')));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(requests[0].canceled).toBe(true);
  expect(requests).toHaveLength(2);
  await act(async () =>
    requests[1].next({
      householdDashboard: { __typename: 'Problem', code: 'FORBIDDEN' },
    }),
  );
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => requests[0].next({ householdDashboard: dashboard }));
  expect(host.textContent).not.toContain('Private Home');
  expect(host.textContent).not.toContain('$8.00');
});
it('refresh cancels an in-flight Members request and rejects its delayed private fields', async () => {
  await act(async () =>
    root.render(<HouseholdRead scope={scope} current="Members" />),
  );
  await act(async () =>
    requests[0].next({
      viewer: {
        __typename: 'Viewer',
        id: 'user-a',
        groups: [{ id: 'H', isHousehold: true }],
      },
    }),
  );
  expect(requests[1].name).toBe('householdMembersQuery');
  act(() => window.dispatchEvent(new Event('focus')));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(requests[0].canceled).toBe(true);
  expect(requests[1].canceled).toBe(true);
  expect(requests).toHaveLength(3);
  await act(async () =>
    requests[2].next({
      viewer: { __typename: 'Problem', code: 'FORBIDDEN' },
    }),
  );
  await act(async () =>
    requests[1].next({
      group: {
        __typename: 'Group',
        id: 'H',
        viewerMembership: { role: 'OWNER' },
        members: [
          {
            id: 'secret',
            displayName: 'Private old member',
            role: 'MEMBER',
            status: 'ACTIVE',
          },
        ],
      },
    }),
  );
  expect(host.textContent).not.toContain('Private old member');
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
