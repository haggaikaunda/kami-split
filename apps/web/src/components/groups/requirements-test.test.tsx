// @vitest-environment jsdom
import { act } from 'react';
import Link from 'next/link';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroupJourney } from './journey';
import { RestoreSource, SourceReturn } from './navigation';
const mock = vi.hoisted(() => ({
  path: '/groups',
  search: '',
  push: vi.fn(),
  access: {} as Record<string, unknown>,
  requests: [] as {
    name: string;
    variables: Record<string, unknown>;
    next: (data: unknown) => void;
    error: (error: Error) => void;
    resolve: (data: unknown) => void;
  }[],
}));
vi.mock('./session', () => ({ useFinancialSession: () => mock.access }));
vi.mock('next/link', () => ({
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
vi.mock('relay-runtime', () => ({
  fetchQuery: (
    _environment: unknown,
    document: { params: { name: string } },
    variables: Record<string, unknown>,
  ) => {
    const request = {
      name: document.params.name,
      variables,
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
        return { unsubscribe() {} };
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
  environment: {},
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
function viewer(items = groups) {
  return {
    viewer: {
      __typename: 'Viewer',
      id: 'A',
      displayName: 'Alice',
      today: '2026-10-04',
      canCreateGroups: false,
      groups: items,
    },
  };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.requests = [];
  scope.visits.clear();
  scope.restored.clear();
  mock.path = '/groups';
  mock.search = '';
  mock.push.mockReset();
  mock.access = { scope, loading: false };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render(ui: React.ReactNode) {
  await act(async () => root.render(ui));
}
async function respond(data: unknown) {
  await act(async () => mock.requests.at(-1)!.next(data));
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
    group: {
      __typename: 'Group',
      id,
      name: id === 'T' ? 'Trip with friends' : 'Private household',
      currency: 'USD',
      kind: id === 'T' ? 'TRIP' : 'ORDINARY',
      isHousehold: id === 'H',
      trip: id === 'T' ? groups[1].trip : null,
      viewerMembership: { id: 'member-A' },
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
            edges: options.empty
              ? []
              : [
                  {
                    node: {
                      id: 'pre-trip',
                      description: 'Pre-trip booking',
                      effectiveDate: '2025-01-01',
                      totalMinor: '9007199254740993',
                      category: 'TRAVEL',
                      note: '',
                      payer: { displayName: 'Alice' },
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
  await act(async () => mock.requests.at(-1)!.resolve(data));
}
it('retains exact group-local money and pre-trip history independent of date status', async () => {
  await render(<GroupJourney initialGroup="T" />);
  await respond(viewer());
  await resolveGroup(groupResult('T'));
  expect(host.textContent).toContain('Pre-trip booking');
  expect(host.textContent).toContain('2025-01-01');
  expect(host.textContent).toContain('90,071,992,547,409.93');
  expect(host.textContent).not.toContain('Private household');
  expect(
    host.querySelector('a[href^="/groups/T/expenses/pre-trip"]'),
  ).not.toBeNull();
});
it('distinguishes an actual empty group from failed expense and balance reads', async () => {
  await render(<GroupJourney initialGroup="T" />);
  await respond(viewer());
  await resolveGroup(groupResult('T', { empty: true }));
  expect(host.textContent).toContain('This group has no expenses.');
  const refresh = host.querySelector('button')!;
  await act(async () => refresh.click());
  await resolveGroup(
    groupResult('T', { pageFailed: true, balancesFailed: true }),
  );
  expect(host.textContent).toContain('expense page failed');
  expect(host.textContent).toContain('Balances are unavailable');
  expect(host.textContent).not.toContain('This group has no expenses');
  expect(host.textContent).not.toContain('Settled:');
});
it('hides records on access refresh and restores full history after readmission', async () => {
  await render(<GroupJourney initialGroup="T" />);
  await respond(viewer());
  await resolveGroup(groupResult('T'));
  await act(async () => host.querySelector('button')!.click());
  expect(host.textContent).not.toContain('Pre-trip booking');
  await resolveGroup({ group: { __typename: 'Problem', code: 'NOT_FOUND' } });
  expect(host.textContent).not.toContain('Pre-trip booking');
  expect(host.textContent).not.toContain('Add expense');
  await act(async () => host.querySelector('button')!.click());
  await resolveGroup(groupResult('T'));
  expect(host.textContent).toContain('Pre-trip booking');
});
it('invalidates visible records on foregrounding before accepting another authorized response', async () => {
  await render(<GroupJourney initialGroup="T" />);
  await respond(viewer());
  await resolveGroup(groupResult('T'));
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(host.textContent).not.toContain('Pre-trip booking');
  expect(host.textContent).toContain('stale');
});

it('rereads the same source URL before revealing private fields on return', async () => {
  mock.path = '/groups/T';
  await render(<GroupJourney initialGroup="T" />);
  await respond(viewer());
  await resolveGroup(groupResult('T'));
  mock.search = 'restore=return-token';
  await render(<GroupJourney initialGroup="T" />);
  expect(host.textContent).not.toContain('Pre-trip booking');
  expect(mock.requests.at(-1)!.name).toBe('journeyViewerQuery');
  await respond(viewer());
  await resolveGroup(groupResult('T'));
  expect(host.textContent).toContain('Pre-trip booking');
});
it('returns a denied source group to safe Groups selection', async () => {
  mock.path = '/groups/T';
  mock.search = 'restore=return-token';
  await render(<GroupJourney initialGroup="T" />);
  await respond(viewer());
  await resolveGroup({ group: { __typename: 'Problem', code: 'NOT_FOUND' } });
  expect(mock.push).toHaveBeenCalledWith('/groups?restore=return-token');
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
    href: '/groups/T?after=page-2',
    focus: 'expense-pre-trip',
    scroll: 120,
    group: 'T',
  });
  await render(<SourceReturn scope={scope as never} />);
  expect(host.querySelector('a')!.getAttribute('href')).toBe(
    '/groups/T?after=page-2&restore=visit',
  );
  mock.path = '/groups/T';
  mock.search = 'after=page-2&restore=visit';
  await render(<GroupJourney initialGroup="T" />);
  await respond(viewer());
  expect(mock.requests.at(-1)!.variables).toEqual({ id: 'T', after: 'page-2' });
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
    href: '/groups/T',
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
      <Link id="expense-target" href="/groups/T">
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
    href: '/groups/T',
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
      <Link id="expense-target" href="/groups/T">
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
  mock.path = '/groups/T';
  mock.search = 'restore=consumed-return';
  scope.restored.add('consumed-return');
  await render(<GroupJourney initialGroup="T" />);
  await respond(viewer());
  await resolveGroup(groupResult('T'));
  expect(host.textContent).toContain('Pre-trip booking');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(host.textContent).not.toContain('Pre-trip booking');
  await respond(viewer([groups[2]]));
  await resolveGroup({ group: { __typename: 'Problem', code: 'NOT_FOUND' } });
  expect(mock.push).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('Pre-trip booking');
  expect(host.textContent).toContain('cannot access');
});
