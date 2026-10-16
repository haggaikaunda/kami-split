// @vitest-environment jsdom
import { queryEnvironment, relayRoot } from '@/lib/relay/test-queries';
import { act } from 'react';
import { foregroundRefresh } from '../workspace-refresh.test-utils';
import Link from 'next/link';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroupJourney } from './journey';
import { HouseholdLedger } from './household-ledger';
import { HouseholdFrame } from './household-frame';
// Banner source authorization has dedicated coverage; keep this journey harness focused on its existing requests.
vi.mock('./household-banner-action', () => ({
  HouseholdBannerAction: () => null,
}));
import { RestoreSource, SourceReturn } from './navigation';
const mock = vi.hoisted(() => ({
  path: '/groups',
  search: '',
  push: vi.fn(),
  mutation: vi.fn(),
  access: {} as Record<string, unknown>,
  requests: [] as {
    name: string;
    variables: Record<string, unknown>;
    canceled: boolean;
    next: (data: unknown) => void;
    error: (error: Error) => void;
    resolve: (data: unknown) => void;
  }[],
}));
vi.mock('./session', () => ({ useFinancialSession: () => mock.access }));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({
    children,
    onNavigate,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    onNavigate?: (event: { preventDefault: () => void }) => void;
    scroll?: boolean;
  }) => {
    const { scroll, ...rest } = props;
    void scroll;
    return (
      <a
        {...rest}
        onClick={(event) => {
          event.preventDefault();
          onNavigate?.(event);
        }}
      >
        {children}
      </a>
    );
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mock.push, replace: mock.push }),
  usePathname: () => mock.path,
  useSearchParams: () => new URLSearchParams(mock.search),
}));
vi.mock('relay-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('relay-runtime')>()),
  commitMutation: (...args: unknown[]) => mock.mutation(...args),
  fetchQuery: (
    _environment: unknown,
    document: { params: { name: string } },
    variables: Record<string, unknown>,
  ) => {
    const request = {
      name: document.params.name,
      variables,
      canceled: false,
      next: (_data: unknown) => {
        void _data;
      },
      error: (_error: Error) => {
        void _error;
      },
      resolve: (_data: unknown) => {
        void _data;
      },
    };
    mock.requests.push(request);
    return {
      subscribe: (callbacks: {
        next: typeof request.next;
        error: typeof request.error;
      }) => {
        Object.assign(request, callbacks);
        return {
          unsubscribe() {
            request.canceled = true;
          },
        };
      },
      toPromise: () =>
        new Promise((resolve) => {
          request.resolve = resolve;
        }),
    };
  },
}));
let root: Root, host: HTMLDivElement;
const scope = {
  id: 'scope-a',
  actor: 'a',
  environment: queryEnvironment(() => {}),
  isLive: () => true,
  visits: new Map(),
  restored: new Set<string>(),
  dispose() {},
};
const groups = [
  {
    id: 'H',
    name: 'Private household',
    kind: 'ORDINARY',
    isHousehold: true,
    trip: null,
  },
  {
    id: 'T',
    name: 'Trip with friends',
    kind: 'TRIP',
    isHousehold: false,
    trip: {
      startDate: '2026-10-04',
      endDate: '2026-10-06',
      destination: 'Somewhere',
    },
  },
  {
    id: 'F',
    name: 'Friends',
    kind: 'ORDINARY',
    isHousehold: false,
    trip: null,
  },
];
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.requests = [];
  scope.environment = queryEnvironment((request) =>
    mock.requests.push(request),
  );
  scope.visits.clear();
  scope.restored.clear();
  mock.path = '/trips/T';
  mock.search = '';
  mock.push.mockReset();
  mock.mutation.mockReset();
  mock.access = { scope, loading: false };
  host = document.createElement('div');
  document.body.append(host);
  root = relayRoot(
    createRoot(host),
    () => mock.access.scope as typeof scope | undefined,
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render(ui: React.ReactNode) {
  await act(async () => root.render(ui));
}

function groupResult(
  id: string,
  options: {
    balancesFailed?: boolean;
    pageFailed?: boolean;
    empty?: boolean;
  } = {},
) {
  return {
    viewer: { __typename: 'Viewer', id: 'A', today: '2026-10-04' },
    group: {
      __typename: 'Group',
      id,
      name: id === 'T' ? 'Trip with friends' : 'Private household',
      currency: 'USD',
      kind: id === 'T' ? 'TRIP' : 'ORDINARY',
      isHousehold: id === 'H',
      trip: id === 'T' ? groups[1].trip : null,
      viewerMembership: { id: 'member-A', role: 'OWNER' },
      members: [],
      balances: options.balancesFailed
        ? { __typename: 'Problem', code: 'UNAVAILABLE' }
        : {
            __typename: 'GroupBalances',
            groupId: id,
            totalExpenseMinor: '9007199254740993',
            settled: false,
            positions: [],
            obligations: [],
          },
      expenses: options.pageFailed
        ? null
        : {
            id: 'expense-page-' + id,
            edges: options.empty
              ? []
              : [
                  {
                    cursor: 'pre-trip',
                    node: {
                      id: 'snapshot-pre-trip-1',
                      expenseId: 'pre-trip',
                      version: '1',
                      description: 'Pre-trip booking',
                      effectiveDate: '2025-01-01',
                      totalMinor: '9007199254740993',
                      category: 'TRAVEL',
                      note: '',
                      payer: { id: 'member-A', displayName: 'Alice' },
                      allocations: [],
                    },
                  },
                ],
            pageInfo: { hasPreviousPage: false, hasNextPage: false },
          },
    },
  };
}
async function resolveGroup(data: unknown) {
  await act(async () => mock.requests.at(-1)!.next(data));
}
it('retains exact group-local money and pre-trip history independent of date status', async () => {
  await render(<GroupJourney trips initialGroup="T" />);
  await resolveGroup(groupResult('T'));
  expect(host.textContent).toContain('Pre-trip booking');
  expect(host.querySelector('time[datetime="2025-01-01"]')?.textContent).toBe(
    'Jan 1',
  );
  expect(host.textContent).toContain('90,071,992,547,409.93');
  expect(host.textContent).not.toContain('Private household');
  expect(
    host.querySelector('a[href^="/trips/T/expenses/pre-trip"]'),
  ).not.toBeNull();
});
it('distinguishes an actual empty group from failed expense and balance reads', async () => {
  await render(<GroupJourney trips initialGroup="T" />);
  await resolveGroup(groupResult('T', { empty: true }));
  expect(host.textContent).toContain('This group has no expenses.');
  await foregroundRefresh();
  await resolveGroup(
    groupResult('T', { pageFailed: true, balancesFailed: true }),
  );
  expect(host.textContent).toContain('expense page failed');
  expect(host.textContent).toContain('Balances are unavailable');
  expect(host.textContent).not.toContain('This group has no expenses');
  expect(host.textContent).not.toContain('Settled:');
});
it('hides records on access refresh and restores full history after readmission', async () => {
  await render(<GroupJourney trips initialGroup="T" />);
  await resolveGroup(groupResult('T'));
  await foregroundRefresh();
  expect(host.textContent).not.toContain('Pre-trip booking');
  await resolveGroup({ group: { __typename: 'Problem', code: 'NOT_FOUND' } });
  expect(host.textContent).not.toContain('Pre-trip booking');
  expect(host.textContent).not.toContain('Add expense');
  await foregroundRefresh();
  await resolveGroup(groupResult('T'));
  expect(host.textContent).toContain('Pre-trip booking');
});
it('invalidates visible records on foregrounding before accepting another authorized response', async () => {
  await render(<GroupJourney trips initialGroup="T" />);
  await resolveGroup(groupResult('T'));
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await act(
    async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(host.textContent).not.toContain('Pre-trip booking');
  expect(host.textContent).toContain('Loading workspace');
  expect(host.querySelector('nav[aria-label="Trip workspace"]')).not.toBeNull();
});

it('rereads an explicitly invalidated source URL before revealing private fields on return', async () => {
  mock.path = '/trips/T';
  await render(<GroupJourney trips initialGroup="T" />);
  await resolveGroup(groupResult('T'));
  scope.environment.commitUpdate((store) => {
    (store as typeof store & { invalidateStore(): void }).invalidateStore();
  });
  mock.search = 'restore=return-token';
  await render(<GroupJourney trips initialGroup="T" />);
  expect(host.textContent).not.toContain('Pre-trip booking');
  expect(mock.requests.at(-1)!.name).toBe('journeyWorkspaceQuery');
  await resolveGroup(groupResult('T'));
  expect(host.textContent).toContain('Pre-trip booking');
});
it('returns a denied Trip source to safe Trips selection', async () => {
  mock.path = '/trips/T';
  mock.search = 'restore=return-token';
  await render(<GroupJourney trips initialGroup="T" />);
  await resolveGroup({ group: { __typename: 'Problem', code: 'NOT_FOUND' } });
  expect(mock.push).toHaveBeenCalledWith('/trips?restore=return-token');
  expect(host.textContent).not.toContain('Pre-trip booking');
});
it('returns to the original filtered source and group expense cursor', async () => {
  scope.visits.set('visit', {
    href: '/trips?filter=past',
    focus: 'group-T',
    scroll: 120,
  });
  mock.search = 'source=visit';
  await render(<SourceReturn scope={scope as never} />);
  expect(host.querySelector('a')!.getAttribute('href')).toBe(
    '/trips?filter=past&restore=visit',
  );
  scope.visits.set('visit', {
    href: '/trips/T?after=page-2',
    focus: 'expense-pre-trip',
    scroll: 120,
    group: 'T',
  });
  await render(<SourceReturn scope={scope as never} />);
  expect(host.querySelector('a')!.getAttribute('href')).toBe(
    '/trips/T?after=page-2&restore=visit',
  );
  mock.path = '/trips/T';
  mock.search = 'after=page-2&restore=visit';
  await render(<GroupJourney trips initialGroup="T" />);
  // Legacy source URLs remain intact; the structured ledger starts its own signed traversal.
  expect(mock.requests.at(-1)!.variables).toMatchObject({
    id: 'T',
    ledger: true,
    overview: false,
  });
});
it('restores logical focus and scroll only for an authorized source; missing source focuses heading', async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  scope.visits.set('visit', {
    href: '/trips/T',
    focus: 'expense-target',
    scroll: 123,
    group: 'T',
  });
  mock.search = 'restore=visit';
  await render(
    <>
      <h1 data-page-heading tabIndex={-1}>
        Groups
      </h1>
      <Link id="expense-target" href="/trips/T">
        Target
      </Link>
      <RestoreSource scope={scope as never} allowed={['T']} />
    </>,
  );
  await act(async () => frames.shift()!(0));
  expect(document.activeElement!.id).toBe('expense-target');
  expect(scroll).toHaveBeenLastCalledWith(0, 123);
  mock.search = 'restore=missing-visit';
  await render(
    <>
      <h1 data-page-heading tabIndex={-1}>
        Groups
      </h1>
      <RestoreSource scope={scope as never} allowed={[]} />
    </>,
  );
  await act(async () => frames.shift()!(0));
  expect(document.activeElement!.textContent).toBe('Groups');
  expect(scroll).toHaveBeenLastCalledWith(0, 0);
  vi.unstubAllGlobals();
});

it('does not repeat focus or scroll on background remount, but permits another explicit source return', async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  scope.visits.set('return', {
    href: '/trips/T',
    focus: 'expense-target',
    scroll: 123,
    group: 'T',
  });
  mock.search = 'restore=return';
  const source = (key: string) => (
    <>
      <h1 data-page-heading tabIndex={-1}>
        Groups
      </h1>
      <button id="reader-control">Reader control</button>
      <Link id="expense-target" href="/trips/T">
        Target
      </Link>
      <RestoreSource key={key} scope={scope as never} allowed={['T']} />
    </>
  );
  await render(source('initial'));
  await act(async () => frames.shift()!(0));
  expect(document.activeElement!.id).toBe('expense-target');
  expect(scroll).toHaveBeenCalledTimes(1);
  host.querySelector<HTMLButtonElement>('#reader-control')!.focus();
  await render(source('background-refresh'));
  expect(frames).toHaveLength(0);
  expect(document.activeElement!.id).toBe('reader-control');
  expect(scroll).toHaveBeenCalledTimes(1);
  mock.search = 'source=return';
  await render(<SourceReturn scope={scope as never} />);
  await act(async () => host.querySelector<HTMLAnchorElement>('a')!.click());
  expect(scope.restored.has('return')).toBe(false);
  mock.search = 'restore=return';
  await render(source('explicit-return'));
  await act(async () => frames.shift()!(0));
  expect(document.activeElement!.id).toBe('expense-target');
  expect(scroll).toHaveBeenCalledTimes(2);
  vi.unstubAllGlobals();
});

it('does not redirect a consumed source return when a later background group read is denied', async () => {
  mock.path = '/trips/T';
  mock.search = 'restore=consumed-return';
  scope.restored.add('consumed-return');
  await render(<GroupJourney trips initialGroup="T" />);
  await resolveGroup(groupResult('T'));
  expect(host.textContent).toContain('Pre-trip booking');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await act(
    async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(host.textContent).not.toContain('Pre-trip booking');
  await resolveGroup({ group: { __typename: 'Problem', code: 'NOT_FOUND' } });
  expect(mock.push).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('Pre-trip booking');
  expect(host.textContent).toContain('cannot access');
});

it('refreshes complete positions and repayment history after recording while expense totals remain unchanged', async () => {
  sessionStorage.clear();
  mock.path = '/trips/T/repayments/new';
  mock.search = 'sender=a&recipient=b&amount=1001';
  const a = {
    id: 'a',
    displayName: 'Alice',
    status: 'ACTIVE',
    role: 'MEMBER',
    canParticipate: true,
  };
  const b = { ...a, id: 'b', displayName: 'Bob' };
  const data = groupResult('T');
  Object.assign(data.group, {
    viewerMembership: a,
    members: [a, b],
    repayments: { edges: [], pageInfo: { hasNextPage: false } },
  });
  Object.assign(data.group.balances, {
    positions: [
      {
        member: a,
        netMinor: '-1001',
        paidMinor: '0',
        owedMinor: '1001',
        sentMinor: '0',
        receivedMinor: '0',
      },
    ],
    obligations: [{ from: a, to: b, amountMinor: '1001' }],
  });
  await render(<GroupJourney trips initialGroup="T" repayment />);
  await resolveGroup(data);
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((b) => b.textContent === 'Record repayment')!
      .click(),
  );
  const input = mock.mutation.mock.calls[0][1].variables.input;
  await act(async () =>
    mock.mutation.mock.calls[0][1].onCompleted(
      {
        recordRepayment: {
          __typename: 'RepaymentCommitted',
          key: input.key,
          record: {
            repaymentId: 'R',
            groupId: 'T',
            senderMembershipId: 'a',
            recipientMembershipId: 'b',
            amountMinor: '1001',
            currency: 'USD',
            effectiveDate: input.effectiveDate,
            note: '',
          },
        },
      },
      null,
    ),
  );
  expect(host.textContent).not.toContain('Pre-trip booking');
  expect(mock.requests.at(-1)!.name).toBe('journeyWorkspaceQuery');
  Object.assign(data.group.balances, {
    settled: true,
    obligations: [],
    positions: [
      {
        member: a,
        netMinor: '0',
        paidMinor: '0',
        owedMinor: '1001',
        sentMinor: '1001',
        receivedMinor: '0',
      },
    ],
  });
  Object.assign(data.group, {
    repayments: {
      edges: [
        {
          node: {
            id: 'R',
            sender: a,
            recipient: b,
            amountMinor: '1001',
            effectiveDate: input.effectiveDate,
            note: '',
          },
        },
      ],
    },
  });
  await resolveGroup(data);
  expect(host.textContent).toContain(
    'Everyone in this space is settled: each member’s balance is zero',
  );
  expect(host.textContent).toContain('Alice → Bob');
  expect(host.textContent).toContain('10.01 USD');
  mock.path = '/trips/T';
  mock.search = '';
  await render(<GroupJourney trips initialGroup="T" />);
  await resolveGroup(data);
  expect(host.textContent).toContain('90,071,992,547,409.93');
  expect(host.textContent).toContain('Pre-trip booking');
  sessionStorage.clear();
});

it.each([
  ['H', '/groups/H', '', '', false, '/household/ledger'],
  [
    'H',
    '/groups/H',
    'tab=members&source=visit',
    '',
    false,
    '/household/ledger?tab=members&source=visit',
  ],
  [
    'H',
    '/groups/H/expenses/E',
    'category=HOME&source=visit',
    'E',
    false,
    '/household/ledger?category=HOME&source=visit&tab=expenses&expense=E',
  ],
  [
    'H',
    '/groups/H/repayments/new',
    'sender=a&recipient=b&amount=1001&source=visit',
    '',
    true,
    '/household/ledger?sender=a&recipient=b&amount=1001&source=visit&tab=balances&repayment=1',
  ],
  [
    'T',
    '/groups/T',
    'tab=activity&source=visit',
    '',
    false,
    '/trips/T?tab=activity&source=visit',
  ],
  [
    'T',
    '/groups/T/expenses/E',
    'source=visit',
    'E',
    false,
    '/trips/T/expenses/E?source=visit',
  ],
  [
    'T',
    '/groups/T/repayments/new',
    'sender=a&recipient=b&amount=1001',
    '',
    true,
    '/trips/T/repayments/new?sender=a&recipient=b&amount=1001',
  ],
] as const)(
  'replaces authorized legacy %s route %s while retaining original visit context',
  async (id, path, search, expense, repayment, canonical) => {
    mock.path = path;
    mock.search = search;
    await render(
      <GroupJourney
        initialGroup={id}
        expense={expense}
        repayment={repayment}
      />,
    );
    expect(mock.push).not.toHaveBeenCalled();
    expect(mock.requests.at(-1)?.variables).toMatchObject({ id });
    await resolveGroup(groupResult(id));
    expect(mock.push).toHaveBeenCalledExactlyOnceWith(canonical);
    expect(host.textContent).not.toContain('Pre-trip booking');
    expect(host.textContent).not.toContain('Private household');
  },
);

it('keeps an authorized ordinary group named Household in its own Group workspace', async () => {
  mock.path = '/groups/F';
  const data = groupResult('F');
  data.group.name = 'Household';
  await render(<GroupJourney initialGroup="F" />);
  await resolveGroup(data);
  expect(mock.push).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Pre-trip booking');
  expect(
    host.querySelector(
      '[data-ui~="workspace-navigation"] a[aria-current="page"]',
    )?.textContent,
  ).toBe('Groups');
  expect(
    host.querySelector('a[href^="/groups/F/expenses/pre-trip"]'),
  ).not.toBeNull();
});

it.each(['NOT_FOUND', 'UNAUTHENTICATED', 'UNAVAILABLE'])(
  'never infers a Household or Trip redirect from inaccessible metadata (%s)',
  async (code) => {
    mock.path = '/groups/H';
    await render(<GroupJourney initialGroup="H" />);
    await resolveGroup({
      viewer: { __typename: 'Problem', code },
      group: { __typename: 'Problem', code },
    });
    expect(mock.push).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Private household');
    expect(host.textContent).not.toContain('Pre-trip booking');
    expect(host.textContent).not.toContain('Settled');
  },
);

const householdViewer = (id = 'H') => ({
  viewer: {
    __typename: 'Viewer',
    id: 'A',
    today: '2026-10-04',
    canCreateGroups: false,
    groups: [
      {
        id,
        name: 'Authorized home',
        kind: 'ORDINARY',
        isHousehold: true,
        trip: null,
      },
    ],
  },
});
const originalLedger = () => (
  <HouseholdFrame>
    <HouseholdLedger />
  </HouseholdFrame>
);

it('resolves the original Household ledger from authorized discovery and keeps one dedicated frame', async () => {
  mock.path = '/household/ledger';
  mock.search = 'tab=members&groupId=other-client-id';
  await render(originalLedger());
  expect(mock.requests.at(-1)?.name).toBe('householdAccessQuery');
  expect(mock.requests.at(-1)?.variables).toEqual({});
  expect(host.querySelectorAll('main')).toHaveLength(1);
  expect(
    host.querySelectorAll('nav[aria-label="Household workspace"]'),
  ).toHaveLength(1);
  expect(host.querySelector('nav[aria-label="Trip workspace"]')).toBeNull();
  expect(host.querySelector('nav[aria-label="Group workspace"]')).toBeNull();
  await resolveGroup(householdViewer());
  expect(mock.requests.at(-1)?.variables).toMatchObject({ id: 'H' });
  await resolveGroup(groupResult('H'));
  expect(mock.push).not.toHaveBeenCalled();
  expect(host.querySelector('h1')?.textContent).toBe('Household');
  expect(
    host.querySelector(
      '[data-ui~="workspace-navigation"] a[aria-current="page"]',
    )?.textContent,
  ).toBe('Household');
  expect(
    [...host.querySelectorAll('[data-ui~="workspace-tabs"] a')].map((a) =>
      a.getAttribute('href'),
    ),
  ).toEqual(
    ['overview', 'expenses', 'balances', 'activity', 'members'].map(
      (tab) => '/household/ledger?tab=' + tab,
    ),
  );
  expect(host.querySelectorAll('main')).toHaveLength(1);
  expect(host.querySelectorAll('[data-ui~="workspace-tabs"]')).toHaveLength(1);
});

it.each([
  { viewer: { __typename: 'Problem', code: 'NOT_FOUND' } },
  { viewer: { __typename: 'Viewer', groups: [groups[2]] } },
  {
    viewer: {
      __typename: 'Viewer',
      groups: [groups[0], { ...groups[0], id: 'another-home' }],
    },
  },
])(
  'does not manufacture an original ledger from denied, absent or ambiguous Household discovery (%j)',
  async (data) => {
    mock.path = '/household/ledger';
    await render(originalLedger());
    await resolveGroup(data);
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].name).toBe('householdAccessQuery');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Household ledger access is unavailable',
    );
    expect(mock.push).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('Pre-trip booking');
    expect(host.textContent).not.toContain('$0.00');
  },
);

it('Household ledger discovery and workspace discard old-account results immediately', async () => {
  mock.path = '/household/ledger';
  mock.search = 'tab=members';
  await render(originalLedger());
  const oldDiscovery = mock.requests.find(
    (r) => r.name === 'householdAccessQuery',
  )!;
  await resolveGroup(householdViewer());
  const oldWorkspace = mock.requests.at(-1)!;
  expect(mock.requests.some((r) => r.name === 'householdAccessQuery')).toBe(
    true,
  );
  mock.access = {
    scope: {
      ...scope,
      id: 'scope-b',
      actor: 'b',
      environment: queryEnvironment((request) => mock.requests.push(request)),
    },
    loading: false,
  };
  await render(originalLedger());
  expect(oldDiscovery.canceled).toBe(true);
  expect(oldWorkspace.canceled).toBe(true);
  expect(mock.requests.at(-1)?.name).toBe('householdAccessQuery');
  await act(async () => {
    oldDiscovery.next(householdViewer());
    oldWorkspace.next(groupResult('H'));
  });
  expect(mock.requests).toHaveLength(3);
  expect(host.textContent).not.toContain('Pre-trip booking');
  await resolveGroup({ viewer: { __typename: 'Viewer', groups: [] } });
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(mock.push).not.toHaveBeenCalled();
});

it('foregrounding the original Household ledger clears private data before rediscovery and rejects late work', async () => {
  mock.path = '/household/ledger';
  await render(originalLedger());
  await resolveGroup(householdViewer());
  await resolveGroup(groupResult('H'));
  expect(host.textContent).toContain('Pre-trip booking');
  const oldDiscovery = mock.requests[0],
    oldWorkspace = mock.requests[1];
  act(() => window.dispatchEvent(new Event('focus')));
  expect(host.textContent).not.toContain('Pre-trip booking');
  expect(oldDiscovery.canceled).toBe(true);
  expect(oldWorkspace.canceled).toBe(true);
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
  expect(mock.requests.at(-1)?.name).toBe('householdAccessQuery');
  await act(async () => {
    oldDiscovery.next(householdViewer());
    oldWorkspace.next(groupResult('H'));
  });
  expect(host.textContent).not.toContain('Pre-trip booking');
  await resolveGroup({ viewer: { __typename: 'Problem', code: 'NOT_FOUND' } });
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain('Settled');
  expect(mock.push).not.toHaveBeenCalled();
});

it('does not resolve a wrong original group as the Household after authorized discovery', async () => {
  mock.path = '/household/ledger';
  await render(originalLedger());
  await resolveGroup(householdViewer());
  await resolveGroup(groupResult('F'));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain('Pre-trip booking');
  expect(mock.push).not.toHaveBeenCalled();
});

it('canonical Household expense details retain original IDs and the dedicated frame', async () => {
  mock.path = '/household/ledger';
  mock.search = 'tab=expenses&expense=E&source=original-source';
  await render(originalLedger());
  await resolveGroup(householdViewer());
  expect(mock.requests.at(-1)?.variables).toMatchObject({ id: 'H' });
  await resolveGroup(groupResult('H'));
  expect(mock.requests.at(-1)?.name).toBe('journeyExpenseQuery');
  expect(mock.requests.at(-1)?.variables).toEqual({ id: 'E' });
  await resolveGroup({
    node: {
      __typename: 'Expense',
      id: 'E',
      groupId: 'H',
      version: '1',
      canEdit: false,
      editLockReason: 'NOT_CREATOR',
      split: 'EQUAL',
      description: 'Original Household dinner',
      totalMinor: '1001',
      currency: 'USD',
      category: 'DINING',
      effectiveDate: '2026-10-04',
      createdAt: '2026-10-04T12:00:00Z',
      note: '',
      payer: { id: 'member-A', displayName: 'Alice' },
      creator: { id: 'member-A', displayName: 'Alice' },
      allocations: [],
    },
  });
  expect(host.textContent).toContain('Original Household dinner');
  expect(host.textContent).toContain('$10.01');
  expect(host.querySelectorAll('main')).toHaveLength(1);
  expect(
    host.querySelector('main > h1, [data-ui~="workspace-header"] h1')
      ?.textContent,
  ).toBe('Household');
  expect(host.querySelector('dialog[open] h1')?.textContent).toBe(
    'Expense detail',
  );
  expect(
    host.querySelector(
      '[data-ui~="workspace-navigation"] a[aria-current="page"]',
    )?.textContent,
  ).toBe('Household');
  expect(mock.push).not.toHaveBeenCalled();
});

it('canonical Household repayments keep the original group operation scope and suggestions', async () => {
  sessionStorage.clear();
  mock.path = '/household/ledger';
  mock.search = 'tab=balances&repayment=1&sender=a&recipient=b&amount=1001';
  await render(originalLedger());
  await resolveGroup(householdViewer());
  const a = {
    id: 'a',
    displayName: 'Alice',
    status: 'ACTIVE',
    role: 'MEMBER',
    canParticipate: true,
  };
  const b = { ...a, id: 'b', displayName: 'Bob' };
  const data = groupResult('H');
  Object.assign(data.group, {
    viewerMembership: a,
    members: [a, b],
    repayments: { edges: [], pageInfo: { hasNextPage: false } },
  });
  Object.assign(data.group.balances, {
    positions: [
      {
        member: a,
        netMinor: '-1001',
        paidMinor: '0',
        owedMinor: '1001',
        sentMinor: '0',
        receivedMinor: '0',
      },
    ],
    obligations: [{ from: a, to: b, amountMinor: '1001' }],
  });
  await resolveGroup(data);
  expect(host.querySelector('h1')?.textContent).toBe('Household');
  expect(host.querySelectorAll('main')).toHaveLength(1);
  expect(
    (host.querySelector('#repayment-sender') as HTMLSelectElement).value,
  ).toBe('a');
  expect(
    (host.querySelector('#repayment-recipient') as HTMLSelectElement).value,
  ).toBe('b');
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((b) => b.textContent === 'Record repayment')!
      .click(),
  );
  const input = mock.mutation.mock.calls[0][1].variables.input;
  expect(input).toMatchObject({
    groupId: 'H',
    senderId: 'a',
    recipientId: 'b',
    amountMinor: '1001',
  });
  expect(mock.push).not.toHaveBeenCalled();
  await act(async () =>
    mock.mutation.mock.calls[0][1].onError(new Error('timeout')),
  );
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((b) => b.textContent === 'Recover original repayment')!
      .click(),
  );
  expect(mock.requests.at(-1)?.name).toBe('journeyRepaymentRecoveryQuery');
  expect(mock.requests.at(-1)?.variables).toMatchObject({
    groupId: 'H',
    key: input.key,
  });
  sessionStorage.clear();
});

it('does not redirect a legacy route from wrong-ID metadata or a late account response', async () => {
  mock.path = '/groups/H';
  await render(<GroupJourney initialGroup="H" />);
  const previous = mock.requests.at(-1)!;
  await resolveGroup(groupResult('F'));
  expect(mock.push).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  mock.access = {
    scope: {
      ...scope,
      id: 'scope-b',
      actor: 'b',
      environment: queryEnvironment((request) => mock.requests.push(request)),
    },
    loading: false,
  };
  await render(<GroupJourney initialGroup="H" />);
  expect(previous.canceled).toBe(true);
  await act(async () => previous.next(groupResult('H')));
  expect(mock.push).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('Private household');
  expect(host.textContent).not.toContain('Pre-trip booking');
  await resolveGroup({
    viewer: { __typename: 'Problem', code: 'NOT_FOUND' },
    group: { __typename: 'Problem', code: 'NOT_FOUND' },
  });
  expect(mock.push).not.toHaveBeenCalled();
});

it('logout cancels canonical Household discovery and keeps the authorized destination behind sign-in', async () => {
  mock.path = '/household/ledger';
  mock.search = 'tab=balances&source=old-visit&restore=old-restore';
  await render(originalLedger());
  const pending = mock.requests.at(-1)!;
  mock.access = { loading: false };
  await render(originalLedger());
  expect(pending.canceled).toBe(true);
  const signIn = host.querySelector<HTMLAnchorElement>('a[href^="/sign-in?"]')!;
  expect(new URL(signIn.href).searchParams.get('next')).toBe(
    '/household/ledger?tab=balances',
  );
  await act(async () => pending.next(householdViewer()));
  expect(mock.requests).toHaveLength(1);
  expect(mock.requests.every((r) => r.canceled)).toBe(true);
  expect(host.textContent).not.toContain('Pre-trip booking');
  expect(host.textContent).not.toContain('Authorized home');
});

it('does not canonicalize a denied original Group from a separately successful viewer discovery', async () => {
  mock.path = '/groups/H';
  await render(<GroupJourney initialGroup="H" />);
  await resolveGroup({
    ...householdViewer(),
    group: { __typename: 'Problem', code: 'NOT_FOUND' },
  });
  expect(mock.push).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain('Authorized home');
  expect(host.textContent).not.toContain('Pre-trip booking');
});
