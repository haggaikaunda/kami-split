// @vitest-environment jsdom
import { act } from 'react';
import { foregroundRefresh } from '../workspace-refresh.test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExpenseEntryProvider, useExpenseEntry } from './entry';
import { ExpenseLedger } from './ledger';
import { HouseholdFrame } from '@/components/groups/household-frame';
import { HouseholdExpenses } from './household';
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
  useLinkStatus: () => ({ pending: false }),
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
vi.mock('@/components/groups/session', () => ({
  useFinancialSession: () => ({ scope, loading: false, error: '' }),
}));
vi.mock('@/components/groups/expense-form', () => ({
  ExpenseForm: ({ onCommitted }: { onCommitted: () => Promise<void> }) => (
    <button onClick={() => void onCommitted()}>Commit persisted expense</button>
  ),
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
    expenseId: id,
    version: '1',
    groupId: 'home',
    description: `Dinner ${id}`,
    effectiveDate: date,
    category: 'DINING',
    totalMinor: amount,
    payer: { id: 'other', displayName: 'Bob' },
    allocations: [
      { participant: { id: 'me', displayName: 'Alice' }, amountMinor: '0' },
    ],
  },
});
const page = (edges = [edge('one', '2026-09-02')], more = false) => ({
  __typename: 'ExpenseView',
  contextVersion: 'scope-v1',
  totalExpenseMinor: '9007199254740994',
  viewerShareMinor: '0',
  viewerPaidMinor: '0',
  categories: [
    {
      category: 'DINING',
      totalExpenseMinor: '9007199254740994',
      viewerShareMinor: '0',
      expenseCount: '2',
    },
  ],
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
let preparedContext: object | undefined;
const scope = {
  id: 'alice',
  environment: {},
  isLive: () => live,
} as FinancialScope;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  preparedContext = undefined;
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
function Banner() {
  const entry = useExpenseEntry();
  return (
    <a
      id="workspace-add"
      href="/household/expenses?create=home"
      onClick={(event) => {
        entry?.activate(event, 'home');
        event.preventDefault();
      }}
    >
      Add expense
    </a>
  );
}
async function render(groupId = '') {
  await act(async () =>
    root.render(
      <ExpenseEntryProvider scope={scope} visit="household-expenses">
        <Banner />
        <ExpenseLedger
          scope={scope}
          groupId={groupId}
          spaces={spaces}
          today="2026-09-03"
          onDenied={vi.fn()}
        />
      </ExpenseEntryProvider>,
    ),
  );
}
async function respond(value: unknown, index = state.requests.length - 1) {
  await act(async () =>
    state.requests[index].next?.({
      ...preparedContext,
      householdExpenses: value,
      groupExpenses: value,
    }),
  );
  preparedContext = undefined;
}
async function click(text: string) {
  const b = [...host.querySelectorAll('button')].find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent)?.trim() === text,
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
    host.querySelector('[data-ui~="space-chip"]')?.textContent ??
      host.querySelector('.ledger-description')?.textContent,
  ).toContain('Home');
  await render('home');
  await respond(page());
  expect(host.querySelector('select[name="groupId"]')).toBeNull();
  expect(host.querySelector('.ledger-description')?.textContent).not.toContain(
    'Home',
  );
  expect(
    host.querySelector('[aria-label="Total expenses"]')?.textContent,
  ).toContain('total');
  expect(host.textContent).not.toContain('Active spaces');
  expect(host.querySelector('input[type="search"]')).toBeNull();
});
it('removes stale rows immediately and rejects late responses and unavailable totals', async () => {
  await render();
  await respond(page());
  await foregroundRefresh();
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
    filter: {
      categories: ['DINING'],
      memberIds: ['other'],
      from: '2026-09-01',
    },
  });
  await respond({
    ...page([]),
    totalExpenseMinor: '0',
    expenseCount: '0',
    months: [],
  });
  expect(host.textContent).toContain('No expenses match these filters');
  expect(host.querySelector('[aria-label="Active filters"]')).not.toBeNull();
  expect(host.textContent).toContain('Filters · 3');
  expect(host.textContent).toContain('Clear all');
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
    filter: { categories: ['GROCERIES'] },
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
        id: 'one',
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
  await act(
    async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(host.textContent).not.toContain('Private detail note');
  expect(host.textContent).not.toContain('Source: Home');
  expect(host.textContent).toContain('Loading expense');
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
const context = (net: string, name = 'Home') => ({
  viewer: { __typename: 'Viewer', today: '2026-09-03' },
  householdDashboard: {
    __typename: 'HouseholdDashboard',
    state: 'COMPLETE',
    contextVersion: 'scope-v1',
    totals: {
      __typename: 'HouseholdDashboardTotals',
      viewerNetMinor: net,
      activeSpaceCount: '1',
    },
    spaces: [{ ...spaces[0], name }],
  },
});
async function renderHousehold() {
  await act(async () =>
    root.render(
      <HouseholdFrame>
        <HouseholdExpenses />
      </HouseholdFrame>,
    ),
  );
}
async function respondContext(value: object) {
  preparedContext = value;
}
it('manual household refresh replaces expense rows and eligible-space snapshot from its context owner', async () => {
  await renderHousehold();
  await respondContext(context('-101'));
  await respond(page());
  expect(host.textContent).toContain('Dinner one');
  await foregroundRefresh();
  expect(host.textContent).not.toContain('Dinner one');
  expect(host.textContent).toContain('Loading expenses');
  await respondContext(context('205', 'New eligible space'));
  await respond(page([]));
  expect(host.textContent).not.toContain('Dinner one');
  await click('Filters');
  expect(host.querySelector('select[name="groupId"]')?.textContent).toContain(
    'New eligible space',
  );
  expect(
    host.querySelector('select[name="groupId"]')?.textContent,
  ).not.toContain('Home');
});
it('foreground refresh rechecks the household owner and removes revoked spaces', async () => {
  await renderHousehold();
  await respondContext(context('-101'));
  await respond(page());
  await act(async () => window.dispatchEvent(new Event('focus')));
  await act(
    async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(host.textContent).not.toContain('Dinner one');
  const revoked = context('0');
  revoked.householdDashboard.spaces = [];
  await respondContext(revoked);
  await respond({
    ...page([]),
    totalExpenseMinor: '0',
    expenseCount: '0',
    months: [],
  });
  await click('Filters');
  expect(
    host.querySelector('select[name="groupId"]')?.textContent,
  ).not.toContain('Home');
  expect(
    [...host.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Add expense',
    )?.disabled,
  ).toBeUndefined();
});
it('successful persisted creation refreshes owning household totals and eligible context', async () => {
  state.params = 'create=home';
  await renderHousehold();
  await respondContext(context('-101'));
  await respond(page());
  await click('Commit persisted expense');
  expect(host.textContent).toContain('Loading expenses');
  expect(state.replace).toHaveBeenCalledWith('/household/expenses?', {
    scroll: false,
  });
  await respondContext(context('302', 'Updated home'));
  await respond({
    ...page([edge('created', '2026-09-02', '302')]),
    totalExpenseMinor: '302',
  });
  expect(host.textContent).toContain('Dinner created');
  expect(
    host.querySelector('[aria-label="Total expenses"]')?.textContent,
  ).toContain('$3.02');
  expect(host.textContent).toContain('Updated home');
});
it('returns from Expenses to canonical Household workspace tabs instead of group discovery', async () => {
  await renderHousehold();
  await respondContext(context('0'));
  await respond(page([]));
  expect(
    [...host.querySelectorAll('[data-ui~="workspace-tabs"] a')].map((a) =>
      a.getAttribute('href'),
    ),
  ).toEqual([
    '/household?tab=overview',
    '/household/expenses',
    '/household?tab=balances',
    '/household/activity',
    '/household?tab=members',
  ]);
});

it('edits structured filters in a dialog and applies an explicit reset to the URL', async () => {
  state.params = 'category=DINING&from=2026-09-01';
  await render();
  await respond(page());
  expect(host.querySelector('form.ledger-filters')).toBeNull();
  await click('Filters · 2');
  const category = host.querySelector<HTMLInputElement>(
    'input[name="categories"][value="DINING"]',
  )!;
  expect(category.checked).toBe(true);
  await click('Reset filters');
  expect(category.checked).toBe(false);
  expect(
    host.querySelector<HTMLInputElement>('input[name="from"]')!.value,
  ).toBe('');
  expect(state.push).not.toHaveBeenCalled();
  await click('Apply filters');
  expect(state.push).toHaveBeenCalledWith('/household/expenses?', {
    scroll: false,
  });
  expect(host.querySelector('dialog')).toBeNull();
});

it('preserves combined filters while switching views and drilling into complete category aggregates', async () => {
  state.params =
    'view=breakdown&groupId=home&memberId=me&from=2026-09-01&to=2026-09-30';
  await render();
  await respond(page(undefined, true));
  expect(host.querySelector('.breakdown-center')?.textContent).toContain(
    '90,071,992,547,409.94',
  );
  expect(host.querySelector('.breakdown-legend')?.textContent).toContain(
    '2 expenses',
  );
  expect(host.querySelector('.ledger-month')).toBeNull();
  const category = host.querySelector(
    '.breakdown-legend button',
  ) as HTMLButtonElement;
  await act(async () => category.click());
  await click('View expenses');
  const next = new URL(
    state.push.mock.calls.at(-1)![0],
    'https://example.test',
  );
  expect(next.searchParams.get('view')).toBeNull();
  expect(next.searchParams.get('categories')).toBe('DINING');
  expect(next.searchParams.get('memberId')).toBe('me');
  expect(next.searchParams.get('from')).toBe('2026-09-01');
  expect(next.searchParams.get('to')).toBe('2026-09-30');
});
it('removes only the selected active filter chip', async () => {
  state.params = 'category=DINING&memberId=me&from=2026-09-01&view=breakdown';
  await render();
  await respond(page());
  await click('Remove Dining');
  const next = new URL(
    state.push.mock.calls.at(-1)![0],
    'https://example.test',
  );
  expect(next.searchParams.get('category')).toBeNull();
  expect(next.searchParams.get('memberId')).toBe('me');
  expect(next.searchParams.get('from')).toBe('2026-09-01');
  expect(next.searchParams.get('view')).toBe('breakdown');
});

it('names the member source and past filter year without changing filter values', async () => {
  state.params =
    'groupId=home&category=DINING&memberId=me&from=2025-09-01&to=2026-09-03';
  await render();
  await respond(page());
  expect(
    [...host.querySelectorAll('.ledger-filter-chip')].map((chip) =>
      chip.textContent?.trim(),
    ),
  ).toEqual([
    'Space: Home',
    'From Sep 1, 2025',
    'To Sep 3',
    'Dining',
    'Involving: Alice · Home',
  ]);
  expect(host.querySelector('.ledger-filter-button')?.textContent).toContain(
    'Filters · 5',
  );
  expect(state.requests[0].variables).toMatchObject({
    filter: {
      groupId: 'home',
      categories: ['DINING'],
      memberIds: ['me'],
      from: '2025-09-01',
      to: '2026-09-03',
    },
  });
  await click('Clear all');
  expect(state.push).toHaveBeenCalledWith('/household/expenses?', {
    scroll: false,
  });
});

it.each(['invalid', '2026-02-31', '0000-01-01', '2026-9-01'])(
  'keeps invalid date %s removable while the server rejects its URL',
  async (value) => {
    state.params = `from=${value}`;
    await render();
    await respond({ __typename: 'Problem', code: 'INVALID_INPUT' });
    expect(host.querySelector('.ledger-filter-chip')?.textContent).toContain(
      `From ${value}`,
    );
    await click(`Remove From ${value}`);
    expect(state.push).toHaveBeenCalledWith('/household/expenses?', {
      scroll: false,
    });
  },
);

it('shows complete filtered month totals before later pages and keeps payer and detail links readable', async () => {
  state.params = 'category=DINING&from=2026-08-15';
  await render();
  const first = page([edge('one', '2026-09-02', '100')], true);
  first.expenseCount = '9';
  first.months = [
    {
      month: '2026-09',
      totalExpenseMinor: '9007199254740994',
      expenseCount: '8',
    },
    { month: '2026-08', totalExpenseMinor: '1234', expenseCount: '1' },
  ];
  await respond(first);
  const september = host.querySelector('.ledger-month > header')!;
  expect(september.textContent).toContain('September 2026');
  expect(september.textContent).toContain('$90,071,992,547,409.94');
  expect(september.textContent).toContain('8 expenses');
  expect(september.querySelector('.ledger-month-count')?.textContent).toBe(
    '8 expenses',
  );
  expect(
    september.querySelector('.ledger-month-heading > h2')?.textContent,
  ).toBe('September 2026');
  expect(september.querySelector('.ledger-month-total')?.textContent).toBe(
    '$90,071,992,547,409.94 USD',
  );
  expect(host.querySelectorAll('.ledger-month li')).toHaveLength(1);
  expect(september.querySelector('details')).toBeNull();
  expect(host.querySelector('.ledger-payer')?.textContent).toBe('Paid by Bob');
  expect(
    host.querySelector('#ledger-expense-one')?.getAttribute('href'),
  ).toContain('expense=one');
  expect(
    host.querySelector('#ledger-expense-one')?.getAttribute('href'),
  ).toContain('category=DINING');
  await click('Load more expenses');
  const second = page([edge('two', '2026-08-20', '1234')]);
  second.months = first.months;
  await respond(second);
  const headers = host.querySelectorAll('.ledger-month > header');
  expect(headers).toHaveLength(2);
  expect(headers[0].textContent).toBe(september.textContent);
  expect(headers[1].textContent).toContain('August 2026');
  expect(headers[1].querySelector('.ledger-month-heading')?.textContent).toBe(
    'August 20261 expense',
  );
  expect(headers[1].querySelector('.ledger-month-total')?.textContent).toBe(
    '$12.34 USD',
  );
  await foregroundRefresh();
  expect(host.querySelector('.ledger-month')).toBeNull();
  await act(async () => state.requests.at(-1)?.error?.());
  expect(host.querySelector('.ledger-month')).toBeNull();
  expect(host.textContent).toContain('Total unavailable');
  expect(host.textContent).not.toContain('Paid by Bob');
});

it('keeps expense controls focused on views and filters without a balance explainer', async () => {
  await renderHousehold();
  await respondContext(context('0'));
  await respond(page([]));
  expect(host.textContent).not.toContain('Balance details');
  expect(host.querySelector('.ledger-net')).toBeNull();
  expect(host.querySelector('.ledger-view-switch')?.textContent).toContain(
    'Breakdown',
  );
  expect(host.querySelector('.ledger-filter-button')?.textContent).toContain(
    'Filters',
  );
});

it('preserves interleaved month order for amount sort and displays complete monthly totals', async () => {
  state.params = 'sort=AMOUNT_DESC';
  await render();
  await respond({
    ...page([
      edge('large', '2026-08-01', '300'),
      edge('middle', '2026-09-01', '200'),
      edge('small', '2026-08-02', '100'),
    ]),
    months: [
      { month: '2026-09', totalExpenseMinor: '200', expenseCount: '1' },
      { month: '2026-08', totalExpenseMinor: '400', expenseCount: '2' },
    ],
  });
  expect(
    [...host.querySelectorAll('.ledger-description strong')].map(
      (el) => el.textContent,
    ),
  ).toEqual(['Dinner large', 'Dinner middle', 'Dinner small']);
  expect(
    host.querySelector('[aria-label="Monthly totals"]')?.textContent,
  ).toContain('2026-08: $4.00');
});
it('uses server encounter order for ascending date month groups', async () => {
  state.params = 'sort=DATE_ASC';
  await render();
  await respond({
    ...page([edge('first', '2026-08-01'), edge('second', '2026-09-01')]),
    months: [
      { month: '2026-09', totalExpenseMinor: '2', expenseCount: '1' },
      { month: '2026-08', totalExpenseMinor: '1', expenseCount: '1' },
    ],
  });
  expect(
    [...host.querySelectorAll('.ledger-month')].map((el) =>
      el.getAttribute('aria-label'),
    ),
  ).toEqual(['2026-08', '2026-09']);
});
it('restarts paging when only a second selected value changes and ignores the superseded response', async () => {
  state.params = 'categories=DINING&categories=GROCERIES';
  await render();
  await respond(page(undefined, true));
  await click('Load more expenses');
  const old = state.requests.at(-1)!;
  state.params = 'categories=DINING&categories=TRANSPORT';
  await render();
  expect(state.requests.at(-1)?.variables).toMatchObject({
    after: null,
    filter: { categories: ['DINING', 'TRANSPORT'] },
  });
  await act(async () =>
    old.next?.({ householdExpenses: page([edge('stale', '2026-09-02')]) }),
  );
  expect(host.textContent).not.toContain('Dinner stale');
  await respond(page([edge('fresh', '2026-09-02')]));
  expect(host.textContent).toContain('Dinner fresh');
});
it('removes one selected category and retains other categories and payer filters', async () => {
  state.params = 'categories=DINING&categories=GROCERIES&paidByIds=me';
  await render();
  await respond(page());
  await click('Remove Dining');
  const next = new URL(
    state.push.mock.calls.at(-1)![0],
    'https://example.test',
  );
  expect(next.searchParams.getAll('categories')).toEqual(['GROCERIES']);
  expect(next.searchParams.getAll('paidByIds')).toEqual(['me']);
});

it('captures the shared banner creation origin with complete loaded rows and returns through history on cancel', async () => {
  let banner: HTMLAnchorElement;
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return {
        x: 0,
        y: this === banner ? 20 : 0,
        width: 390,
        height: this.classList.contains('expense-ledger') ? 850 : 44,
        top: this === banner ? 20 : 0,
        left: 0,
        bottom: 850,
        right: 390,
        toJSON: () => ({}),
      } as DOMRect;
    });
  const positions = (scope.expensePositions ??= new Map());
  positions.clear();
  state.back.mockClear();
  try {
    await render('home');
    banner = host.querySelector('#workspace-add')!;
    await respond(page([edge('one', '2026-09-02')], true));
    await click('Load more expenses');
    await respond(page([edge('two', '2026-09-01', '1')]));
    await act(async () =>
      banner.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }),
      ),
    );
    expect(positions.size).toBe(0);
    await act(async () =>
      banner.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      ),
    );
    const saved = [...positions.values()][0];
    expect(saved).toMatchObject({ id: 'workspace-add', count: 2, offset: 20 });
    expect(saved.height).toBe(850);
    expect(saved.scroll).toBe(window.scrollY);
    state.params = 'create=home';
    await render('home');
    await click('Close expense');
    expect(state.back).toHaveBeenCalledTimes(1);
    expect(state.replace).not.toHaveBeenCalled();
  } finally {
    positions.clear();
    rect.mockRestore();
  }
});
