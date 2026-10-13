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
    return (
      <a
        {...props}
        onClick={(event) => {
          event.preventDefault();
          (_onNavigate as (() => void) | undefined)?.();
        }}
      >
        {children}
      </a>
    );
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
    id,
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
let observers: IntersectionObserverCallback[] = [];
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
  scope.expensePositions = new Map();
  window.scrollTo = vi.fn();
  observers = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
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
async function render(groupId = '', account = scope) {
  await act(async () =>
    root.render(
      <ExpenseLedger
        scope={account}
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

async function intersect() {
  await act(async () =>
    observers.at(-1)?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
}
async function scroll() {
  await act(async () => window.dispatchEvent(new Event('scroll')));
}
const result = (ids: string[], cursor: string | null) => ({
  ...page(
    ids.map((id) => edge(id, '2026-09-02')),
    !!cursor,
  ),
  pageInfo: { hasNextPage: !!cursor, endCursor: cursor },
});
it('bounds repeated and slow observer callbacks, retains manual retry, deduplicates rows and stops at exhaustion without shifting focus', async () => {
  await render();
  await respond(result(['one'], 'first'));
  const anchor = host.querySelector<HTMLAnchorElement>('#ledger-expense-one')!;
  anchor.focus();
  await intersect();
  await intersect();
  await scroll();
  await intersect();
  expect(state.requests).toHaveLength(2);
  expect(
    host.querySelector('.ledger-pagination [role="status"]')?.textContent,
  ).toContain('Loading more');
  await act(async () => state.requests[1].error?.());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Retry');
  await scroll();
  await intersect();
  expect(state.requests).toHaveLength(2);
  await click('Retry loading expenses');
  expect(state.requests).toHaveLength(3);
  expect(state.requests[2].variables).toMatchObject({ after: 'first' });
  await respond(result(['one', 'two'], 'second'));
  expect(host.querySelectorAll('.ledger-month li')).toHaveLength(2);
  expect(document.activeElement).toBe(anchor);
  await intersect();
  expect(state.requests).toHaveLength(3);
  await click('Load more expenses');
  await respond(result(['three'], null));
  await scroll();
  await intersect();
  expect(state.requests).toHaveLength(4);
  expect(host.textContent).toContain('All expenses loaded.');
  expect(host.textContent).toContain('90,071,992,547,409.94');
});
it.each(['filter', 'sort', 'scope', 'account', 'refresh'])(
  'rejects a late page after %s changes',
  async (kind) => {
    await render();
    await respond(result(['one'], 'first'));
    await intersect();
    const old = state.requests.at(-1)!;
    if (kind === 'filter') state.params = 'category=TRANSPORT';
    if (kind === 'sort') state.params = 'sort=AMOUNT_DESC';
    if (kind === 'refresh') {
      await act(async () => window.dispatchEvent(new Event('focus')));
      await act(
        async () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
    } else
      await render(
        kind === 'scope' ? 'home' : '',
        kind === 'account'
          ? { ...scope, id: 'bob', expensePositions: new Map() }
          : scope,
      );
    expect(state.requests.at(-1)?.variables).toMatchObject({ after: null });
    await act(async () =>
      old.next?.({ householdExpenses: result(['private-stale'], null) }),
    );
    expect(host.textContent).not.toContain('private-stale');
    await respond(result(['fresh'], null));
    expect(host.textContent).toContain('Dinner fresh');
    expect(host.textContent).not.toContain('Dinner one');
  },
);
it('replays authorized pages after browser detail return and focuses the nearest surviving row when the viewed row disappeared', async () => {
  state.params = 'category=DINING';
  await render();
  await respond(result(['one', 'a', 'b', 'c', 'd', 'e'], 'first'));
  await click('Load more expenses');
  await respond(result(['two', 'removed'], null));
  await act(async () =>
    host.querySelector<HTMLAnchorElement>('#ledger-expense-removed')!.click(),
  );
  state.params += '&expense=removed&expenseGroup=home';
  await render();
  state.params = 'category=DINING';
  await render();
  expect(host.textContent).not.toContain('Dinner removed');
  expect(state.requests.at(-1)?.variables).toMatchObject({
    after: null,
    filter: { categories: ['DINING'] },
  });
  await respond(result(['one', 'a', 'b', 'c', 'd', 'e'], 'fresh-first'));
  expect(state.requests.at(-1)?.variables).toMatchObject({
    after: 'fresh-first',
  });
  await respond(result(['two', 'replacement'], null));
  await act(
    async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(document.activeElement?.id).toBe('ledger-expense-replacement');
  expect(window.scrollTo).toHaveBeenCalled();
  expect(host.textContent).not.toContain('Dinner removed');
});
it.each(['UNAUTHENTICATED', 'SESSION_CHANGED'])(
  'removes already loaded rows on paging %s failures',
  async (message) => {
    await render();
    await respond(result(['private'], 'first'));
    await intersect();
    await act(async () =>
      (state.requests.at(-1)?.error as (error: Error) => void)?.(
        new Error(message),
      ),
    );
    expect(host.textContent).not.toContain('Dinner private');
    expect(host.textContent).toContain('Total unavailable');
    await scroll();
    await intersect();
    expect(state.requests).toHaveLength(2);
  },
);
it('restores the selected identity when its sort position changes after a full remount', async () => {
  state.params = 'sort=AMOUNT_DESC';
  await render();
  await respond(result(['one', 'a', 'b', 'c', 'd', 'e'], 'first'));
  await click('Load more expenses');
  await respond(result(['two', 'moved'], null));
  await act(async () =>
    host.querySelector<HTMLAnchorElement>('#ledger-expense-moved')!.click(),
  );
  await act(async () => root.render(null));
  await render();
  expect(host.textContent).not.toContain('Dinner moved');
  await respond(result(['moved', 'one', 'a', 'b', 'c', 'd'], 'fresh-first'));
  expect(state.requests.at(-1)?.variables).toMatchObject({
    after: 'fresh-first',
    filter: { sort: 'AMOUNT_DESC' },
  });
  await respond(result(['e', 'two'], null));
  await act(
    async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(document.activeElement?.id).toBe('ledger-expense-moved');
});
it.each(['repeated cursor', 'empty continuing page', 'missing cursor'])(
  'stops automatic traversal after a %s',
  async (kind) => {
    await render();
    await respond(result(['one'], 'first'));
    await intersect();
    const invalid = result(
      kind === 'empty continuing page' ? [] : ['two'],
      kind === 'repeated cursor' ? 'first' : 'next',
    );
    if (kind === 'missing cursor') invalid.pageInfo.endCursor = null;
    await respond(invalid);
    await scroll();
    await intersect();
    expect(state.requests).toHaveLength(2);
    expect(host.textContent).toContain('pagination changed');
    expect(host.querySelector('.ledger-month')).toBeNull();
  },
);
it('bounds replay even if a server returns duplicate-only pages with changing cursors', async () => {
  await render();
  await respond(result(['one', 'a', 'b', 'c', 'd', 'e'], 'first'));
  await click('Load more expenses');
  await respond(result(['two'], null));
  await act(async () =>
    host.querySelector<HTMLAnchorElement>('#ledger-expense-two')!.click(),
  );
  await act(async () => root.render(null));
  await render();
  await respond(result(['one', 'a', 'b', 'c', 'd', 'e'], 'new-first'));
  const count = state.requests.length;
  await respond(result(['one', 'a', 'b', 'c', 'd', 'e'], 'new-second'));
  await act(
    async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  await intersect();
  expect(state.requests).toHaveLength(count);
  expect(document.activeElement?.id).toBe('ledger-expense-e');
});

it('keeps a newer detail origin when an earlier restoration frame runs before the route transition commits', async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const frameSpy = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    });
  const cancelSpy = vi
    .spyOn(window, 'cancelAnimationFrame')
    .mockImplementation((id) => {
      frames.delete(id);
    });
  try {
    await render();
    await respond(result(['one', 'a', 'b', 'c', 'd', 'e'], 'first'));
    await click('Load more expenses');
    await respond(result(['two', 'late'], null));
    await act(async () =>
      host.querySelector<HTMLAnchorElement>('#ledger-expense-late')!.click(),
    );
    await act(async () => root.render(null));
    await render();
    await respond(result(['one', 'a', 'b', 'c', 'd', 'e'], 'fresh-first'));
    await respond(result(['two', 'late'], null));
    expect(frames.size).toBeGreaterThan(0);
    const previous = scope.expensePositions!.get('/household/expenses::');
    expect(previous?.count).toBe(8);
    // A row activation records its new return origin synchronously; the native
    // route transition may commit after the already queued restoration frame.
    await act(async () =>
      host.querySelector<HTMLAnchorElement>('#ledger-expense-late')!.click(),
    );
    const current = scope.expensePositions!.get('/household/expenses::');
    expect(current).not.toBe(previous);
    await act(async () => {
      for (const callback of frames.values()) callback(0);
    });
    expect(scope.expensePositions!.get('/household/expenses::')).toBe(current);
  } finally {
    frameSpy.mockRestore();
    cancelSpy.mockRestore();
  }
});

it('does not finish a saved-overlay return from the old page while fresh authorization is pending', async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const frameSpy = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    });
  const cancelSpy = vi
    .spyOn(window, 'cancelAnimationFrame')
    .mockImplementation((id) => {
      frames.delete(id);
    });
  try {
    await render();
    await respond(result(['one', 'a', 'b', 'c', 'd', 'e'], 'first'));
    await click('Load more expenses');
    await respond(result(['two', 'late'], null));
    await act(async () =>
      host.querySelector<HTMLAnchorElement>('#ledger-expense-late')!.click(),
    );
    await act(async () => root.render(null));
    state.params = 'create=home';
    await render();
    await respond(result(['one', 'a', 'b', 'c', 'd', 'e'], 'saved-first'));
    await respond(result(['two', 'late'], null));
    const origin = scope.expensePositions!.get('/household/expenses::');
    expect(origin?.count).toBe(8);
    expect(frames.size).toBe(0);
    // Closing a remounted saved overlay starts a fresh read. The previous page
    // from this same commit must not finish restoration before that read.
    state.params = '';
    await render();
    await act(async () => {
      for (const callback of frames.values()) callback(0);
    });
    expect(scope.expensePositions!.get('/household/expenses::')).toBe(origin);
    expect(document.activeElement?.id).not.toBe('ledger-expense-late');
    await respond(result(['one', 'a', 'b', 'c', 'd', 'e'], 'return-first'));
    expect(state.requests.at(-1)?.variables).toMatchObject({
      after: 'return-first',
    });
    await respond(result(['two', 'late'], null));
    await act(async () => {
      for (const callback of frames.values()) callback(0);
    });
    expect(document.activeElement?.id).toBe('ledger-expense-late');
    expect(host.querySelectorAll('.ledger-month li')).toHaveLength(8);
  } finally {
    frameSpy.mockRestore();
    cancelSpy.mockRestore();
  }
});

it('replays fresh pages and the late-row anchor after repeated history remounts', async () => {
  state.params = 'category=DINING';
  await render();
  await respond(result(['one', 'a', 'b', 'c', 'd', 'e'], 'first'));
  await click('Load more expenses');
  await respond(result(['two', 'late'], null));
  await act(async () =>
    host.querySelector<HTMLAnchorElement>('#ledger-expense-late')!.click(),
  );
  // Back, then Forward/close can each remount the source without a new row click.
  for (const suffix of ['back', 'forward-close']) {
    await act(async () => root.render(null));
    await render();
    expect(host.textContent).not.toContain('Dinner late');
    await respond(result(['one', 'a', 'b', 'c', 'd', 'e'], suffix));
    expect(state.requests.at(-1)?.variables).toMatchObject({
      after: suffix,
      filter: { categories: ['DINING'] },
    });
    await respond(result(['two', 'late'], null));
    await act(
      async () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(document.activeElement?.id).toBe('ledger-expense-late');
  }
});
