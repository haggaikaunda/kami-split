// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExpenseLedger } from './ledger';
import type { FinancialScope } from '@/lib/relay/environment';
const state = vi.hoisted(() => ({
  params: '',
  requests: [] as {
    variables: unknown;
    next?: (r: unknown) => void;
    error?: () => void;
    unsubscribe: ReturnType<typeof vi.fn>;
  }[],
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.params),
  usePathname: () => '/household/expenses',
  useRouter: () => ({
    push: state.push,
    replace: state.replace,
    back: state.back,
  }),
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    onNavigate: _onNavigate,
    scroll: _scroll,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    onNavigate?: unknown;
    scroll?: boolean;
  }) => {
    void _onNavigate;
    void _scroll;
    return <a {...props}>{children}</a>;
  },
}));
vi.mock('relay-runtime', () => ({
  readInlineData: (_: unknown, r: unknown) => r,
  fetchQuery: (_: unknown, _doc: unknown, variables: unknown) => {
    const r = {
      variables,
      unsubscribe: vi.fn(),
    } as (typeof state.requests)[number];
    state.requests.push(r);
    return {
      subscribe: (observer: unknown) => {
        Object.assign(r, observer);
        return { unsubscribe: r.unsubscribe };
      },
    };
  },
}));
vi.mock('@/components/groups/expense-form', () => ({
  ExpenseForm: () => <p>Persisted form</p>,
}));
const spaces = [
  {
    groupId: 'home',
    name: 'Home',
    viewerMembership: { id: 'me' },
    members: [
      {
        id: 'me',
        displayName: 'Alice',
        status: 'ACTIVE',
        role: 'OWNER',
        canParticipate: true,
      },
    ],
  },
];
const edge = (id: string, date: string, amount = '9007199254740993') => ({
  cursor: id,
  source: { id: 'home', name: 'Home', currency: 'USD' },
  node: {
    id,
    groupId: 'home',
    description: `Dinner ${id}`,
    effectiveDate: date,
    category: 'DINING',
    totalMinor: amount,
    payer: { id: 'other', displayName: 'Bob' },
    allocations: [{ participant: { id: 'me' }, amountMinor: '0' }],
  },
});
const page = (edges = [edge('one', '2026-09-02')], more = false) => ({
  __typename: 'ExpenseView',
  totalExpenseMinor: '9007199254740994',
  expenseCount: '2',
  months: [
    {
      month: '2026-09',
      totalExpenseMinor: '9007199254740994',
      expenseCount: '2',
    },
  ],
  edges,
  pageInfo: { hasNextPage: more, endCursor: more ? 'cursor' : null },
});
let root: Root, host: HTMLDivElement, live: boolean;
const scope = {
  id: 'alice',
  environment: {},
  isLive: () => live,
} as FinancialScope;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  state.params = '';
  state.replace.mockClear();
  state.requests = [];
  state.push.mockClear();
  live = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function render(groupId = '') {
  await act(async () =>
    root.render(
      <ExpenseLedger
        scope={scope}
        groupId={groupId}
        spaces={spaces}
        today="2026-09-03"
        onDenied={vi.fn()}
      />,
    ),
  );
}
async function respond(value: unknown, index = state.requests.length - 1) {
  await act(async () =>
    state.requests[index].next?.({
      householdExpenses: value,
      groupExpenses: value,
    }),
  );
}
async function click(text: string) {
  const b = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === text,
  )!;
  expect(b).toBeTruthy();
  await act(async () => b.click());
}
it('uses full server totals and month subtotals while accumulating pages, including exact large money and zero shares', async () => {
  await render();
  await respond(page(undefined, true));
  expect(host.textContent).toContain('90,071,992,547,409.94');
  expect(host.textContent).toContain('Your share $0.00');
  await click('Load more expenses');
  expect(state.requests.at(-1)?.variables).toMatchObject({ after: 'cursor' });
  await respond(page([edge('two', '2026-09-01', '1')]));
  expect(host.querySelectorAll('.ledger-month li')).toHaveLength(2);
  expect(host.querySelectorAll('.ledger-month')).toHaveLength(1);
  expect(host.textContent).toContain('Dinner one');
  expect(host.textContent).toContain('Dinner two');
});
it('identifies household sources and omits redundant group sources and space filters', async () => {
  await render();
  await respond(page());
  expect(
    host.querySelector('.ui-space-chip')?.textContent ??
      host.querySelector('.ledger-description')?.textContent,
  ).toContain('Home');
  await render('home');
  await respond(page());
  expect(host.querySelector('select[name="groupId"]')).toBeNull();
  expect(host.querySelector('.ledger-description')?.textContent).not.toContain(
    'Home',
  );
  expect(host.textContent).toContain('Total expenses');
  expect(host.textContent).not.toContain('Active spaces');
  expect(host.querySelector('input[type="search"]')).toBeNull();
});
it('removes stale rows immediately and rejects late responses and unavailable totals', async () => {
  await render();
  await respond(page());
  await click('Refresh expenses');
  expect(host.textContent).not.toContain('Dinner one');
  await respond(page(), 0);
  expect(host.textContent).not.toContain('Dinner one');
  await respond({ __typename: 'Problem', code: 'NOT_FOUND' });
  expect(host.textContent).toContain('Total unavailable');
  expect(host.textContent).not.toContain('90,071,992');
});
it('distinguishes filtered empty and forwards payer/member filters to server', async () => {
  state.params = 'category=DINING&memberId=other&from=2026-09-01';
  await render();
  expect(state.requests[0].variables).toMatchObject({
    filter: { category: 'DINING', memberId: 'other', from: '2026-09-01' },
  });
  await respond({
    ...page([]),
    totalExpenseMinor: '0',
    expenseCount: '0',
    months: [],
  });
  expect(host.textContent).toContain('No expenses match these filters');
  expect(host.textContent).toContain('Active filters');
  expect(host.textContent).toContain('Clear filters');
});
it('ignores responses belonging to a disposed account', async () => {
  await render();
  live = false;
  await respond(page());
  expect(host.textContent).not.toContain('Dinner one');
  await act(async () => root.render(null));
  expect(state.requests[0].unsubscribe).toHaveBeenCalled();
});
it('starts a new traversal when browser history changes structured filters after paging', async () => {
  await render();
  await respond(page(undefined, true));
  await click('Load more expenses');
  await respond(page([edge('two', '2026-09-01', '1')]));
  state.params = 'category=GROCERIES';
  await render();
  expect(state.requests.at(-1)?.variables).toMatchObject({
    after: null,
    filter: { category: 'GROCERIES' },
  });
  expect(host.textContent).not.toContain('Dinner one');
});
it('hides cached selected detail and source during foreground reauthorization and ignores its old source response', async () => {
  state.params = 'expense=one&expenseGroup=home';
  await render();
  const sourceIndex = state.requests.findIndex(
    (r) =>
      JSON.stringify(r.variables) ===
      JSON.stringify({ filter: { groupId: 'home' } }),
  );
  expect(sourceIndex).toBeGreaterThanOrEqual(0);
  await respond(page(), sourceIndex);
  const nodeIndex = state.requests.findIndex(
    (r) => JSON.stringify(r.variables) === JSON.stringify({ id: 'one' }),
  );
  await act(async () =>
    state.requests[nodeIndex].next?.({
      node: {
        ...edge('one', '2026-09-02').node,
        __typename: 'Expense',
        currency: 'USD',
        note: 'Private detail note',
        creator: { displayName: 'Alice' },
        createdAt: '2026-09-02T12:00:00Z',
      },
    }),
  );
  expect(host.textContent).toContain('Private detail note');
  expect(host.textContent).toContain('Source: Home');
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(host.textContent).not.toContain('Private detail note');
  expect(host.textContent).not.toContain('Source: Home');
  expect(host.textContent).toContain('Checking current source access');
  expect(state.requests[sourceIndex].unsubscribe).toHaveBeenCalled();
  await respond(page(), sourceIndex);
  expect(host.textContent).not.toContain('Private detail note');
});
it('rejects a direct household deep link to an ineligible source before fetching the expense', async () => {
  state.params = 'expense=secret&expenseGroup=viewer-only';
  await render();
  const sourceIndex = state.requests.findIndex(
    (r) =>
      JSON.stringify(r.variables) ===
      JSON.stringify({ filter: { groupId: 'viewer-only' } }),
  );
  expect(sourceIndex).toBeGreaterThanOrEqual(0);
  await respond({ __typename: 'Problem', code: 'NOT_FOUND' }, sourceIndex);
  expect(
    state.requests.some(
      (r) => JSON.stringify(r.variables) === JSON.stringify({ id: 'secret' }),
    ),
  ).toBe(false);
  expect(host.textContent).toContain('Expense access changed');
  expect(state.replace).toHaveBeenCalledWith('/household/expenses?', {
    scroll: false,
  });
});
it('invalidates the source list when a freshly authorized deep-link node belongs to another group', async () => {
  state.params = 'expense=one&expenseGroup=home';
  await render();
  const sourceIndex = state.requests.findIndex(
    (r) =>
      JSON.stringify(r.variables) ===
      JSON.stringify({ filter: { groupId: 'home' } }),
  );
  await respond(page(), sourceIndex);
  const nodeIndex = state.requests.findIndex(
    (r) => JSON.stringify(r.variables) === JSON.stringify({ id: 'one' }),
  );
  await act(async () =>
    state.requests[nodeIndex].next?.({
      node: {
        ...edge('one', '2026-09-02').node,
        __typename: 'Expense',
        groupId: 'other',
        description: 'Private other-group expense',
      },
    }),
  );
  expect(host.textContent).not.toContain('Private other-group expense');
  expect(host.textContent).toContain('Expense access changed');
  expect(state.replace).toHaveBeenCalled();
});
