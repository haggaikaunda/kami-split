// @vitest-environment jsdom
import { act, StrictMode, useLayoutEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createOperationDescriptor, type Environment } from 'relay-runtime';
import { NetworkQuery } from './query';
import { queryEnvironment, relayRoot } from './test-queries';
import type { FinancialScope } from './environment';
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
