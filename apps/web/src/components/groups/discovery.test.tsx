// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroupJourney } from './journey';
import { ExpenseDetail } from './expense-detail';
const mock = vi.hoisted(() => ({
  path: '/groups',
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
  useLinkStatus: () => ({ pending: false }),
  default: ({
    children,
    onNavigate,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    onNavigate?: () => void;
    scroll?: boolean;
  }) => {
    void onNavigate;
    const { scroll, ...rest } = props;
    void scroll;
    return <a {...rest}>{children}</a>;
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {} }),
  usePathname: () => mock.path,
  useSearchParams: () => new URLSearchParams(),
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
  mock.path = '/groups';
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
it('keeps general navigation static while limiting source discovery to authorized groups', async () => {
  await render(<GroupJourney />);
  await respond(viewer());
  expect(host.querySelector('a[href="/household"]')?.textContent).toBe(
    'Household',
  );
  expect(host.querySelector('a[href="/groups/H"]')).toBeNull();
  expect(host.querySelector('a[href="/groups/T"]')).toBeNull();
  expect(host.textContent).not.toContain('Private household');
  expect(host.textContent).not.toContain('Total expenses');
  expect(host.querySelector('a[href="/groups/F"]')?.textContent).toContain(
    'Friends',
  );
  expect(host.textContent).not.toContain('Trip with friends');
  mock.path = '/trips';
  await render(<GroupJourney trips />);
  await respond(viewer([groups[1], groups[2]]));
  expect(host.querySelector('a[href="/household"]')?.textContent).toBe(
    'Household',
  );
  expect(host.querySelector('a[href="/groups/H"]')).toBeNull();
  expect(host.textContent).not.toContain('Private household');
  expect(host.textContent).toContain('In progress');
  expect(host.querySelector('a[href="/trips/T"]')).not.toBeNull();
  expect(
    host.querySelector(
      '[data-ui~="workspace-navigation"] a[aria-current="page"]',
    )?.textContent,
  ).toBe('Trips');
  expect(host.textContent).not.toContain('Friends · Group');
});
it('keeps in-progress trips in All only and distinguishes a filtered empty list from no groups', async () => {
  await render(<GroupJourney trips filter="upcoming" />);
  await respond(viewer());
  expect(host.textContent).toContain('No trips match this filter');
  expect(host.textContent).not.toContain('Trip with friends');
  await render(<GroupJourney trips filter="past" />);
  await respond(viewer([]));
  expect(host.textContent).toContain('no admitted trips or groups');
  expect(host.textContent).not.toContain('No trips match');
});
it('hides old group fields immediately and ignores a delayed previous group read', async () => {
  await render(<GroupJourney initialGroup="H" />);
  const old = mock.requests.at(-1)!;
  expect(old.variables.id).toBe('H');
  await render(<GroupJourney initialGroup="T" />);
  await act(async () =>
    old.next({
      group: { __typename: 'Group', id: 'H', name: 'Secret old group' },
    }),
  );
  expect(host.textContent).not.toContain('Secret old group');
  expect(mock.requests.at(-1)!.variables.id).toBe('T');
});
it('never renders wrong-group expense fields even when the node is otherwise authorized', async () => {
  await render(
    <ExpenseDetail scope={scope as never} group="T" id="expense-H" />,
  );
  await respond({
    node: {
      __typename: 'Expense',
      id: 'expense-H',
      groupId: 'H',
      description: 'Secret household expense',
    },
  });
  expect(host.textContent).toContain('Expense unavailable');
  expect(host.textContent).not.toContain('Secret household expense');
});
it('distinguishes failed discovery from no groups and ignores old-account results', async () => {
  await render(<GroupJourney />);
  const old = mock.requests.at(-1)!;
  mock.access = {
    scope: { ...scope, id: 'scope-c', actor: 'c' },
    loading: false,
  };
  await render(<GroupJourney />);
  await act(async () => old.next(viewer()));
  expect(host.textContent).not.toContain('Private household');
  await act(async () => mock.requests.at(-1)!.error(new Error('UNAVAILABLE')));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain('No ordinary groups yet');
});

it.each([[groups[0]], [groups[1]], [groups[0], groups[1]]])(
  'shows a genuine ordinary Groups empty state when only dedicated spaces are authorized (%j)',
  async (...items) => {
    await render(<GroupJourney />);
    await respond(viewer(items));
    expect(host.textContent).toContain('No ordinary groups yet');
    expect(host.querySelector('.group-selection a')).toBeNull();
    expect(host.textContent).not.toContain('Private household');
    expect(host.textContent).not.toContain('Trip with friends');
    expect(host.querySelector('a[href="/household"]')).not.toBeNull();
    expect(host.querySelector('a[href="/trips"]')).not.toBeNull();
  },
);
it('does not infer Household identity from an ordinary group name', async () => {
  await render(<GroupJourney />);
  await respond(viewer([{ ...groups[2], name: 'Household' }]));
  expect(host.querySelector('a[href="/groups/F"]')?.textContent).toContain(
    'Household',
  );
  expect(host.textContent).not.toContain('No ordinary groups yet');
});
it('offers the dedicated Trip creation route while preserving the separate creator capability', async () => {
  mock.path = '/trips';
  await render(<GroupJourney trips />);
  const data = viewer([groups[1]]);
  data.viewer.canCreateGroups = true;
  await respond(data);
  expect(host.querySelector('a[href="/trips/new"]')?.textContent).toBe(
    'Create trip',
  );
  expect(host.querySelector('a[href="/groups/new"]')).toBeNull();
});
