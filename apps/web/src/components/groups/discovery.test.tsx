// @vitest-environment jsdom
import { queryEnvironment, relayRoot } from '@/lib/relay/test-queries';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroupJourney } from './journey';
import { ExpenseDetail } from './expense-detail';
import { createOperationDescriptor } from 'relay-runtime';
import viewerDocument from '@/lib/relay/__generated__/journeyViewerQuery.graphql';
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
function viewer(items = groups) {
  return {
    groupDirectory: {
      __typename: 'GroupDirectory',
      entries: items
        .filter((item) => !item.isHousehold)
        .map((group) => ({
          group: { currency: 'USD', ...group },
          activeMemberCount: 3,
          financialSummary: {
            __typename: 'GroupFinancialSummary',
            totalSpendMinor: '9007199254740993',
            viewerNetMinor: group.kind === 'TRIP' ? '-500' : '0',
          },
        })),
    },
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
  scope.environment = queryEnvironment((request) =>
    mock.requests.push(request),
  );
  mock.path = '/groups';
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
  expect(host.textContent).toContain('Trip with friends');
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
  ).toBe('Groups');
  expect(host.textContent).not.toContain('Friends · Group');
});
it('keeps in-progress trips in All only and distinguishes a filtered empty list from no groups', async () => {
  await render(<GroupJourney trips filter="upcoming" />);
  await respond(viewer());
  expect(host.textContent).toContain('No trips match this filter');
  expect(host.textContent).not.toContain('Trip with friends');
  await render(<GroupJourney trips filter="past" />);
  await respond(viewer([]));
  expect(host.textContent).toContain('no admitted groups or trips');
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
  expect(host.textContent).not.toContain('$90,071,992,547,409.93');
  await act(async () => mock.requests.at(-1)!.error(new Error('UNAVAILABLE')));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain('No groups match this filter');
});

it.each([[groups[0]], [groups[1]], [groups[0], groups[1]]])(
  'shows a genuine ordinary Groups empty state when only dedicated spaces are authorized (%j)',
  async (...items) => {
    await render(<GroupJourney selection="groups" />);
    await respond(viewer(items));
    expect(host.textContent).toContain(
      items.some((item) => item.kind === 'TRIP')
        ? 'No groups match this filter'
        : 'no admitted groups or trips',
    );
    expect(host.querySelector('.group-selection a')).toBeNull();
    expect(host.textContent).not.toContain('Private household');
    expect(host.textContent).not.toContain('Trip with friends');
    expect(host.querySelector('a[href="/household"]')).not.toBeNull();
    expect(host.querySelector('a[href="/groups"]')).not.toBeNull();
  },
);
it('does not infer Household identity from an ordinary group name', async () => {
  await render(<GroupJourney />);
  await respond(viewer([{ ...groups[2], name: 'Household' }]));
  expect(host.querySelector('a[href="/groups/F"]')?.textContent).toContain(
    'Household',
  );
  expect(host.textContent).not.toContain('No groups match this filter');
});
it('offers authorized Group and Trip choices from the shared Create entry', async () => {
  Object.assign(HTMLDialogElement.prototype, { showModal() {}, close() {} });
  await render(<GroupJourney />);
  const data = viewer();
  data.viewer.canCreateGroups = true;
  await respond(data);
  const create = [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Create',
  )!;
  await act(async () => create.click());
  expect(host.querySelector('a[href="/trips/new"]')?.textContent).toBe(
    'Create trip',
  );
  expect(host.querySelector('a[href="/groups/new"]')?.textContent).toBe(
    'Create group',
  );
});

it.each([
  ['UNAUTHENTICATED', 'Your session is unavailable'],
  ['SESSION_CHANGED', 'Your session is unavailable'],
  ['INVALID_CURSOR', 'This expense page is no longer available'],
])(
  'preserves transport failure copy and refresh failure status (%s)',
  async (code, copy) => {
    await render(<GroupJourney />);
    await act(async () => mock.requests.at(-1)!.error(new Error(code)));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(copy);
    expect(
      host.querySelector('[data-ui~="workspace-refresh"]')?.textContent,
    ).toContain('Couldn’t refresh. Try again.');
  },
);
it.each([
  {
    __typename: 'Problem',
    code: 'UNAUTHENTICATED',
    message: 'Safe test problem',
  },
  { __typename: 'ViewerAccess', state: 'DISABLED' },
])(
  'reports fulfilled access failures to the refresh owner (%j)',
  async (result) => {
    await render(<GroupJourney />);
    await respond({ viewer: result });
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(
      host.querySelector('[data-ui~="workspace-refresh"]')?.textContent,
    ).toContain('Couldn’t refresh. Try again.');
    expect(host.textContent).not.toContain('Up to date');
  },
);

it('renders the card fragment from its retained store record without a copied server object', async () => {
  await render(<GroupJourney />);
  await respond(viewer());
  const count = mock.requests.length;
  await act(async () =>
    scope.environment.commitPayload(
      createOperationDescriptor(viewerDocument, {}),
      viewer([{ ...groups[2], name: 'Renamed friends' }]),
    ),
  );
  expect(host.querySelector('a[href="/groups/F"]')?.textContent).toContain(
    'Renamed friends',
  );
  expect(mock.requests).toHaveLength(count);
});

it('renders complete exact spend and personal positions without using ledger rows or claiming everyone settled', async () => {
  await render(<GroupJourney />);
  await respond(viewer());
  const cards = host.querySelector('[data-ui="discovery-cards"]')!;
  expect(cards.textContent).toContain(
    'Total spend · USD$90,071,992,547,409.93',
  );
  expect(cards.textContent).toContain('3 active members');
  expect(cards.textContent).toContain('You owe');
  expect(cards.textContent).toContain('Nothing for you to pay or collect');
  expect(cards.textContent).not.toContain('Settled');
  expect(mock.requests).toHaveLength(1);
});

it('distinguishes authorized zero from a failed financial aggregate and an inaccessible directory', async () => {
  await render(<GroupJourney />);
  const data = viewer();
  data.groupDirectory.entries[0].financialSummary = {
    __typename: 'Problem',
    code: 'UNAVAILABLE',
  } as never;
  data.groupDirectory.entries[1].financialSummary.totalSpendMinor = '0';
  await respond(data);
  expect(host.querySelector('a[href="/trips/T"]')?.textContent).toContain(
    'Unavailable',
  );
  expect(host.querySelector('a[href="/trips/T"]')?.textContent).not.toContain(
    '$0.00',
  );
  expect(host.querySelector('a[href="/groups/F"]')?.textContent).toContain(
    '$0.00',
  );
  await act(async () =>
    scope.environment.commitPayload(
      createOperationDescriptor(viewerDocument, {}),
      { ...data, groupDirectory: { __typename: 'Problem', code: 'NOT_FOUND' } },
    ),
  );
  expect(host.querySelector('[data-ui="discovery-cards"]')).toBeNull();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});

it('reads a large directory in one operation and subscribes to corrected aggregate and active-member facts', async () => {
  const items = Array.from({ length: 75 }, (_, index) => ({
    ...groups[2],
    id: `G${index}`,
    name: `Group ${index}`,
  }));
  await render(<GroupJourney />);
  const data = viewer(items);
  await respond(data);
  expect(
    host.querySelectorAll('[data-ui="discovery-cards"] > li'),
  ).toHaveLength(75);
  expect(mock.requests.map((request) => request.name)).toEqual([
    'journeyViewerQuery',
  ]);
  data.groupDirectory.entries[0].activeMemberCount = 1;
  data.groupDirectory.entries[0].financialSummary = {
    __typename: 'GroupFinancialSummary',
    totalSpendMinor: '12345',
    viewerNetMinor: '321',
  };
  await act(async () =>
    scope.environment.commitPayload(
      createOperationDescriptor(viewerDocument, {}),
      data,
    ),
  );
  const first = host.querySelector('a[href="/groups/G0"]')!;
  expect(first.textContent).toContain('1 active member');
  expect(first.textContent).toContain('$123.45');
  expect(first.textContent).toContain('You’re owed');
  expect(mock.requests).toHaveLength(1);
});

it('reports a transient complete-directory failure as unavailable with retry rather than an empty or access-denied result', async () => {
  await render(<GroupJourney />);
  await respond({
    ...viewer(),
    groupDirectory: { __typename: 'Problem', code: 'UNAVAILABLE' },
  });
  expect(host.querySelector('[data-ui="discovery-cards"]')).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'Financial data is unavailable',
  );
  expect(
    host.querySelector('[data-ui~="workspace-refresh"]')?.textContent,
  ).toContain('Couldn’t refresh');
  expect(host.textContent).not.toContain('no admitted groups');
  expect(host.textContent).not.toContain('$0.00');
});

it('keeps directory identity accessible without signed-in body copy and names each balance direction', async () => {
  await render(<GroupJourney />);
  const data = viewer();
  data.groupDirectory.entries[1].financialSummary.viewerNetMinor = '12000';
  await respond(data);
  expect(host.querySelector('h1')?.textContent).toBe('Groups');
  expect(host.textContent).not.toContain('Signed in as');
  expect(
    host
      .querySelector('[data-ui="directory-toolbar"] nav')
      ?.getAttribute('aria-label'),
  ).toBe('Group type');
  expect(host.querySelector('a[href^="/trips/T"]')?.textContent).toContain(
    'Your balance · USDYou owe $5.00',
  );
  expect(host.querySelector('a[href^="/groups/F"]')?.textContent).toContain(
    'Your balance · USDYou’re owed $120.00',
  );
});
