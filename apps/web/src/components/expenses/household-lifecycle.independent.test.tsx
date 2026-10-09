// @vitest-environment jsdom
import { act } from 'react';
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
import { HouseholdLedger } from './household';
let search = '',
  alive = true;
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('next/link', () => ({
  default: 'a',
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock('./ledger', () => ({
  ExpenseLedger: ({
    contextVersion,
    initialView,
    onEditSaved,
    onRefreshContext,
  }: {
    onEditSaved: () => void;
    onRefreshContext: () => void;
    contextVersion: string;
    initialView: { filterText: string };
  }) => (
    <div data-ledger>
      {contextVersion}:{initialView.filterText}:private ledger
      <button
        onClick={() => {
          onEditSaved();
          onRefreshContext();
        }}
      >
        Commit fixture edit
      </button>
    </div>
  ),
}));
let root: Root, host: HTMLDivElement, scope: FinancialScope;
let requests: {
  name: string;
  variables: Variables;
  canceled: boolean;
  next(data: unknown): void;
}[];
const result = (
  dashboardVersion = 'same',
  ledgerVersion: string | null = 'same',
) => ({
  viewer: { __typename: 'Viewer', today: '2026-10-05' },
  householdDashboard: {
    __typename: 'HouseholdDashboard',
    state: 'COMPLETE',
    contextVersion: dashboardVersion,
    totals: {
      __typename: 'HouseholdDashboardTotals',
      viewerNetMinor: '10',
      activeSpaceCount: '1',
    },
    spaces: [],
  },
  householdExpenses: {
    __typename: 'ExpenseView',
    contextVersion: ledgerVersion,
    totalExpenseMinor: '10',
    viewerShareMinor: '0',
    viewerPaidMinor: '0',
    categories: [],
    expenseCount: '0',
    months: [],
    edges: [],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  search = 'category=GROCERIES';
  alive = true;
  requests = [];
  const environment = new Environment({
    network: Network.create((operation, variables) =>
      Observable.create((sink) => {
        const request = {
          name: operation.name,
          variables,
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
    isLive: () => alive,
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
it.each([
  ['old', 'new'],
  ['same', null],
])(
  'fails closed when composed context %s and row context %s are incompatible',
  async (context, rows) => {
    await act(async () => root.render(<HouseholdLedger scope={scope} />));
    expect(requests).toHaveLength(1);
    expect(requests[0].name).toBe('expensesHouseholdInitialQuery');
    await act(async () => requests[0].next(result(context!, rows)));
    expect(host.querySelector('[data-ledger]')).toBeNull();
    expect(host.querySelector('[role=alert]')).not.toBeNull();
  },
);
it.each(['householdDashboard', 'householdExpenses'])(
  'does not reveal one-sided successful data when %s fails',
  async (field) => {
    await act(async () => root.render(<HouseholdLedger scope={scope} />));
    await act(async () =>
      requests[0].next({
        ...result(),
        [field]: { __typename: 'Problem', code: 'FORBIDDEN' },
      }),
    );
    expect(host.textContent).not.toContain('private ledger');
    expect(host.querySelector('[role=alert]')).not.toBeNull();
  },
);
it('preserves original filter identity when navigation changes during the composed request', async () => {
  await act(async () => root.render(<HouseholdLedger scope={scope} />));
  expect(requests[0].variables).toMatchObject({
    filter: { category: 'GROCERIES' },
  });
  search = 'category=TRANSPORT';
  await act(async () => root.render(<HouseholdLedger scope={scope} />));
  await act(async () => requests[0].next(result()));
  expect(requests).toHaveLength(1);
  expect(host.textContent).toContain('category=GROCERIES');
  expect(host.textContent).not.toContain('TRANSPORT');
});
it('rejects late old-scope responses even when transport delivers after account disposal', async () => {
  await act(async () => root.render(<HouseholdLedger scope={scope} />));
  alive = false;
  await act(async () => requests[0].next(result()));
  expect(host.textContent).not.toContain('private ledger');
});
it('hides private context synchronously and coalesces overlapping foreground reads', async () => {
  await act(async () => root.render(<HouseholdLedger scope={scope} />));
  await act(async () => requests[0].next(result()));
  expect(host.textContent).toContain('private ledger');
  act(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
  });
  expect(host.textContent).not.toContain('private ledger');
  expect(requests[0].canceled).toBe(true);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(requests).toHaveLength(2);
  await act(async () => requests[0].next(result()));
  expect(host.textContent).not.toContain('private ledger');
  await act(async () =>
    requests[1].next({
      ...result(),
      householdExpenses: { __typename: 'Problem', code: 'FORBIDDEN' },
    }),
  );
  expect(host.querySelector('[role=alert]')).not.toBeNull();
});

it('retains committed edit status when the separately refreshed Household list fails', async () => {
  await act(async () => root.render(<HouseholdLedger scope={scope} />));
  await act(async () => requests[0].next(result()));
  await act(async () => host.querySelector('button')!.click());
  expect(host.textContent).toContain('Expense edit saved');
  await act(async () =>
    requests[1].next({
      ...result(),
      householdExpenses: { __typename: 'Problem', code: 'UNAVAILABLE' },
    }),
  );
  expect(host.textContent).toContain('Expense edit saved');
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.textContent).not.toContain('private ledger');
});
