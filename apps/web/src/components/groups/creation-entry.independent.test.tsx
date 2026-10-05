// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroupJourney } from './journey';
const mock = vi.hoisted(() => ({
  path: '/groups',
  search: '',
  push: vi.fn(),
  mutation: vi.fn(),
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
  commitMutation: (...args: unknown[]) => mock.mutation(...args),
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
  sessionStorage.clear();
  scope.visits.clear();
  scope.restored.clear();
  mock.path = '/groups';
  mock.search = '';
  mock.push.mockReset();
  mock.mutation.mockReset();
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

it('blocks disabled creator capability on direct creation entry without dispatching a write', async () => {
  mock.path = '/groups/new';
  await render(<GroupJourney creation="ORDINARY" />);
  await respond(viewer([]));
  expect(host.textContent).toContain('This account cannot create groups');
  expect(host.querySelector('form')).toBeNull();
  expect(mock.mutation).not.toHaveBeenCalled();
});
it('canonicalizes an escaped public Group ID before its fresh authorized route read', async () => {
  const id = 'ks1:Group:11111111-1111-4111-8111-111111111111';
  mock.path = '/groups/' + encodeURIComponent(id);
  await render(<GroupJourney initialGroup={encodeURIComponent(id)} />);
  await respond(viewer());
  const request = mock.requests.find((r) => r.name === 'journeyGroupQuery');
  expect(request?.variables.id).toBe(id);
});
