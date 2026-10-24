// @vitest-environment jsdom
import {
  act,
  startTransition,
  StrictMode,
  useLayoutEffect,
  useState,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createOperationDescriptor,
  fetchQuery,
  RecordSource,
  type Environment,
} from 'relay-runtime';
import { NetworkQuery } from './query';
import { queryEnvironment, relayRoot } from './test-queries';
import { createScope, type FinancialScope } from './environment';
import type { SupabaseClient } from '@supabase/supabase-js';
import inventoryQuery, {
  type personalInventoryQuery,
} from './__generated__/personalInventoryQuery.graphql';
import documentQuery, {
  type householdAccessQuery,
} from './__generated__/householdAccessQuery.graphql';

type Request = Parameters<Parameters<typeof queryEnvironment>[0]>[0];
let root: Root,
  host: HTMLDivElement,
  scope: FinancialScope,
  requests: Request[];
const response = (id = 'home') => ({
  viewer: {
    __typename: 'Viewer',
    id: 'viewer',
    groups: [{ id, isHousehold: true }],
  },
});
function Read() {
  return (
    <NetworkQuery<householdAccessQuery>
      scope={scope}
      document={documentQuery}
      variables={{}}
      fallback={<p>Authorizing</p>}
      failure={<p>Read failed</p>}
    >
      {(data) => (
        <p>
          {data.viewer.__typename === 'Viewer'
            ? data.viewer.groups[0]?.id
            : 'Denied'}
        </p>
      )}
    </NetworkQuery>
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  requests = [];
  scope = {
    id: 'a',
    environment: queryEnvironment((r) => requests.push(r)),
    isLive: () => true,
  } as FinancialScope;
  host = document.createElement('div');
  document.body.append(host);
  root = relayRoot(createRoot(host), () => scope);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('requires a new authorization response even when the same complete query is cached', async () => {
  const operation = createOperationDescriptor(documentQuery, {});
  scope.environment.commitPayload(operation, response('cached-private-home'));
  await act(async () => root.render(<Read />));
  expect(requests).toHaveLength(1);
  expect(host.textContent).toContain('Authorizing');
  expect(host.textContent).not.toContain('private-home');
  await act(async () => requests[0].next(response('fresh-home')));
  expect(host.textContent).toBe('fresh-home');
});
it('cancels a pending visit before an identical replacement can share its request', async () => {
  await act(async () => root.render(<Read key="old" />));
  const old = requests[0];
  await act(async () => root.render(<Read key="new" />));
  expect(old.canceled).toBe(true);
  expect(requests).toHaveLength(2);
  await act(async () => old.next(response('old-private-home')));
  expect(host.textContent).toContain('Authorizing');
  expect(host.textContent).not.toContain('private-home');
  await act(async () => requests[1].next(response('current-home')));
  expect(host.textContent).toBe('current-home');
});
it('cancels a query when its owner is invalidated while the initial effect starts the request', async () => {
  let invalidate: () => void = () => {};
  scope.environment = queryEnvironment((request) => {
    requests.push(request);
    invalidate();
  });
  // An access event can arrive synchronously while transport starts, before
  // the loaded query reference has committed into its owner's render.
  function ImmediateVisit() {
    const [active, setActive] = useState(true);
    useLayoutEffect(() => {
      invalidate = () => setActive(false);
    }, []);
    return active ? <Read /> : <p>Visit ended</p>;
  }
  await act(async () => root.render(<ImmediateVisit />));
  expect(host.textContent).toBe('Visit ended');
  expect(requests).toHaveLength(1);
  expect(requests[0].canceled).toBe(true);
  await act(async () => requests[0].next(response('private-home')));
  expect(
    scope.environment.getStore().getSource().get('GroupSummary:private-home'),
  ).toBeUndefined();
});
it('balances query retains across Strict Mode setup, completion and unmount', async () => {
  const retained = new Set<object>();
  const original = scope.environment.retain.bind(scope.environment);
  vi.spyOn(scope.environment, 'retain').mockImplementation(
    (...args: Parameters<Environment['retain']>) => {
      const resource = original(...args);
      const token = {};
      retained.add(token);
      return {
        dispose() {
          retained.delete(token);
          resource.dispose();
        },
      };
    },
  );
  await act(async () =>
    root.render(
      <StrictMode>
        <Read />
      </StrictMode>,
    ),
  );
  const current = requests.at(-1)!;
  await act(async () => current.next(response()));
  expect(host.textContent).toBe('home');
  expect(retained.size).toBeGreaterThan(0);
  await act(async () => root.render(null));
  expect(retained.size).toBe(0);
  expect(requests.every((request) => request.canceled)).toBe(true);
});

it('commits complete fresh Relay data directly without an initialization fallback', async () => {
  const commits: string[] = [];
  function Fallback() {
    useLayoutEffect(() => {
      commits.push('fallback');
    }, []);
    return <p>Authorizing</p>;
  }
  const operation = createOperationDescriptor(documentQuery, {});
  // A network completion, rather than overlapping commitPayload records, establishes fetchTime.
  await act(async () => root.render(<Read />));
  await act(async () => requests[0].next(response('warm-home')));
  await act(async () => root.render(null));
  await act(async () =>
    root.render(
      <NetworkQuery<householdAccessQuery>
        reuse
        scope={scope}
        document={documentQuery}
        variables={{}}
        fallback={<Fallback />}
        failure={<p>Failed</p>}
      >
        {(data) => (
          <p>
            {data.viewer.__typename === 'Viewer'
              ? data.viewer.groups[0]?.id
              : 'Denied'}
          </p>
        )}
      </NetworkQuery>,
    ),
  );
  expect(scope.environment.check(operation).status).toBe('available');
  expect(host.textContent).toBe('warm-home');
  expect(requests).toHaveLength(1);
  expect(commits).toEqual([]);
});

function WarmRead() {
  return (
    <NetworkQuery<householdAccessQuery>
      reuse
      scope={scope}
      document={documentQuery}
      variables={{}}
      fallback={<p>Authorizing</p>}
      failure={<p>Read failed</p>}
    >
      {(data) => (
        <p>
          {data.viewer.__typename === 'Viewer'
            ? data.viewer.groups[0]?.id
            : 'Denied'}
        </p>
      )}
    </NetworkQuery>
  );
}
async function prime() {
  await act(async () => root.render(<Read />));
  await act(async () => requests.at(-1)!.next(response('warm-home')));
  await act(async () => root.render(null));
}
function invalidate() {
  scope.environment.commitUpdate((store) => {
    (store as typeof store & { invalidateStore(): void }).invalidateStore();
  });
}
it('keeps the original fetch time and requires a held fresh read exactly at expiry', async () => {
  let now = 100_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  await prime();
  const operation = createOperationDescriptor(documentQuery, {});
  const fetched = scope.environment.check(operation);
  now += 29_999;
  await act(async () => root.render(<WarmRead key="fresh" />));
  expect(host.textContent).toBe('warm-home');
  expect(requests).toHaveLength(1);
  expect(scope.environment.check(operation)).toEqual(fetched);
  now++;
  await act(async () => root.render(<WarmRead key="expired" />));
  expect(host.textContent).toContain('Authorizing');
  expect(host.textContent).not.toContain('warm-home');
  expect(requests).toHaveLength(2);
  await act(async () => requests[1].next(response('fresh-home')));
  expect(host.textContent).toBe('fresh-home');
});
it('subscribes to real Relay changes and hides invalidated warm content before revalidation', async () => {
  await prime();
  await act(async () => root.render(<WarmRead />));
  await act(async () =>
    scope.environment.commitUpdate((store) => {
      store.get('GroupSummary:home')?.setValue('updated', 'id');
      store.get('GroupSummary:warm-home')?.setValue('updated', 'id');
    }),
  );
  expect(host.textContent).toBe('updated');
  await act(async () => invalidate());
  expect(host.textContent).toContain('Authorizing');
  expect(host.textContent).not.toContain('warm-home');
  expect(requests).toHaveLength(2);
  await act(async () => requests[1].next(response('revalidated')));
  expect(host.textContent).toBe('revalidated');
});
it('rechecks invalidation between render and subscription instead of committing an obsolete warm owner', async () => {
  await prime();
  function InvalidateAtCommit() {
    useLayoutEffect(invalidate, []);
    return null;
  }
  await act(async () =>
    root.render(
      <>
        <InvalidateAtCommit />
        <WarmRead />
      </>,
    ),
  );
  expect(host.textContent).toContain('Authorizing');
  expect(host.textContent).not.toContain('warm-home');
  expect(requests).toHaveLength(2);
});
it('rechecks collection between render and commit and never restores missing records from a retained snapshot', async () => {
  await prime();
  function CollectAtCommit() {
    useLayoutEffect(() => {
      (scope.environment.getStore().getSource() as RecordSource).remove(
        'GroupSummary:warm-home',
      );
      scope.environment.getStore().notify();
    }, []);
    return null;
  }
  await act(async () =>
    root.render(
      <>
        <CollectAtCommit />
        <WarmRead />
      </>,
    ),
  );
  expect(host.textContent).toContain('Authorizing');
  expect(host.textContent).not.toContain('warm-home');
  expect(requests).toHaveLength(2);
});
it('releases every warm owner across repeated visits and Strict Mode cleanup', async () => {
  await prime();
  const retained = new Set<object>();
  const original = scope.environment.retain.bind(scope.environment);
  vi.spyOn(scope.environment, 'retain').mockImplementation((operation) => {
    const resource = original(operation),
      token = {};
    retained.add(token);
    return {
      dispose() {
        retained.delete(token);
        resource.dispose();
      },
    };
  });
  for (let visit = 0; visit < 35; visit++) {
    await act(async () =>
      root.render(
        <StrictMode>
          <WarmRead key={visit} />
        </StrictMode>,
      ),
    );
    expect(host.textContent).toBe('warm-home');
    expect(retained.size).toBe(1);
  }
  await act(async () => root.render(null));
  expect(retained.size).toBe(0);
  expect(requests).toHaveLength(1);
});
it('keeps warm render failures inside the existing error boundary', async () => {
  await prime();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () =>
    root.render(
      <NetworkQuery<householdAccessQuery>
        reuse
        scope={scope}
        document={documentQuery}
        variables={{}}
        fallback={<p>Loading</p>}
        failure={<p>Read failed</p>}
      >
        {() => {
          throw new Error('BROKEN_FRAGMENT');
        }}
      </NetworkQuery>,
    ),
  );
  expect(host.textContent).toBe('Read failed');
  expect(requests).toHaveLength(1);
});

it('real account disposal removes a committed warm snapshot without a parent rerender', async () => {
  scope = createScope(
    {
      auth: {
        getSession: async () => ({
          data: {
            session: { user: { id: 'actor' }, access_token: 'synthetic' },
          },
          error: null,
        }),
      },
    } as unknown as SupabaseClient,
    'actor',
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ data: response('private-account') }), {
          status: 200,
        }),
    ),
  );
  await act(async () => root.render(<Read />));
  await act(async () => root.render(null));
  await act(async () => root.render(<WarmRead />));
  expect(host.textContent).toBe('private-account');
  await act(async () => scope.dispose());
  expect(host.textContent).not.toContain('private-account');
  expect(scope.isLive()).toBe(false);
});
it.each(['update', 'invalidated-refetch'])(
  'rechecks %s before an interrupted warm transition commits and retains no abandoned render',
  async (mode) => {
    await prime();
    let release!: () => void,
      blocked = true;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const commits: string[] = [];
    function Gate() {
      if (blocked) throw gate;
      return null;
    }
    function Content({ value }: { value: string }) {
      useLayoutEffect(() => {
        commits.push(value);
      });
      return <p>{value}</p>;
    }
    const retain = vi.spyOn(scope.environment, 'retain');
    await act(async () =>
      startTransition(() =>
        root.render(
          <>
            <NetworkQuery<householdAccessQuery>
              reuse
              scope={scope}
              document={documentQuery}
              variables={{}}
              fallback={<p>Authorizing</p>}
              failure={<p>Read failed</p>}
            >
              {(data) => (
                <Content
                  value={
                    data.viewer.__typename === 'Viewer'
                      ? (data.viewer.groups[0]?.id ?? '')
                      : 'Denied'
                  }
                />
              )}
            </NetworkQuery>
            <Gate />
          </>,
        ),
      ),
    );
    expect(retain).not.toHaveBeenCalled();
    if (mode === 'invalidated-refetch') {
      invalidate();
      const reading = fetchQuery<householdAccessQuery>(
        scope.environment,
        documentQuery,
        {},
        { fetchPolicy: 'network-only' },
      ).toPromise();
      requests.at(-1)!.next(response('new-before-commit'));
      await reading;
    } else {
      scope.environment.commitPayload(
        createOperationDescriptor(documentQuery, {}),
        response('new-before-commit'),
      );
    }
    await act(async () => {
      blocked = false;
      release();
    });
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every((value) => value === 'new-before-commit')).toBe(true);
    expect(requests).toHaveLength(mode === 'update' ? 1 : 2);
  },
);

it('keeps a cold child mounted after its operation becomes reusable', async () => {
  let mounts = 0;
  function Child() {
    useLayoutEffect(() => {
      mounts++;
    }, []);
    return <p>Ready child</p>;
  }
  await act(async () =>
    root.render(
      <NetworkQuery<householdAccessQuery>
        reuse
        scope={scope}
        document={documentQuery}
        variables={{}}
        fallback={<p>Pending</p>}
        failure={<p>Failed</p>}
      >
        {() => <Child />}
      </NetworkQuery>,
    ),
  );
  await act(async () => requests[0].next(response()));
  expect(mounts).toBe(1);
  await act(async () =>
    scope.environment.commitPayload(
      createOperationDescriptor(documentQuery, {}),
      response('changed'),
    ),
  );
  expect(mounts).toBe(1);
});

it('captures nonempty variables for one keyed warm visit and separates changed inventory pages', async () => {
  const inventory = {
    bankingConnections: {
      __typename: 'BankingConnectionsResult',
      code: 'READY',
      connections: [],
      hasNextPage: false,
      endCursor: null,
    },
  };
  function Inventory({ first }: { first: number }) {
    return (
      <NetworkQuery<personalInventoryQuery>
        reuse
        scope={scope}
        document={inventoryQuery}
        variables={{ first }}
        fallback={<p>Inventory pending</p>}
        failure={<p>Failed</p>}
      >
        {(_data, captured) => <p>page size {captured.first}</p>}
      </NetworkQuery>
    );
  }
  await act(async () => root.render(<Inventory first={20} />));
  await act(async () => requests[0].next(inventory));
  await act(async () => root.render(null));
  await act(async () => root.render(<Inventory first={20} />));
  await act(async () => root.render(<Inventory first={10} />));
  expect(host.textContent).toBe('page size 20');
  expect(requests).toHaveLength(1);
  await act(async () => root.render(<Inventory key="new" first={10} />));
  expect(host.textContent).toContain('Inventory pending');
  expect(requests).toHaveLength(2);
  expect(requests[1].variables.first).toBe(10);
});
