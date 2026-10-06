// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  Environment,
  Network,
  Observable,
  RecordSource,
  Store,
  type Variables,
} from 'relay-runtime';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FinancialScope } from '@/lib/relay/environment';
import { GroupJourney } from './journey';
let search = 'tab=members',
  scope: FinancialScope;
vi.mock('./session', () => ({
  useFinancialSession: () => ({ scope, loading: false }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => '/groups/G',
  useRouter: () => ({ push() {}, replace() {} }),
}));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} aria-current={props['aria-current']}>
      {children}
    </a>
  ),
}));
let root: Root,
  host: HTMLDivElement,
  requests: {
    name: string;
    variables: Variables;
    canceled: boolean;
    next(data: unknown): void;
  }[];
const member = {
  id: 'M',
  displayName: 'Private member',
  role: 'OWNER',
  status: 'ACTIVE',
  canParticipate: true,
};
const group = {
  __typename: 'Group',
  id: 'G',
  name: 'Private group',
  currency: 'USD',
  kind: 'ORDINARY',
  isHousehold: false,
  trip: null,
  viewerMembership: member,
  members: [member],
};
const viewer = { __typename: 'Viewer', today: '2026-10-05' };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  search = 'tab=members';
  requests = [];
  const environment = new Environment({
    network: Network.create((operation, variables) =>
      Observable.create((sink) => {
        const request = {
          name: operation.name,
          variables,
          canceled: false,
          next(data: unknown) {
            sink.next({ data } as never);
          },
        };
        requests.push(request);
        return () => {
          request.canceled = true;
        };
      }),
    ),
    store: new Store(new RecordSource()),
  });
  scope = {
    id: 'test',
    actor: 'A',
    environment,
    isLive: () => true,
    visits: new Map(),
    restored: new Set(),
  } as FinancialScope;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it('keeps the same public tab shell while destination changes cancel old requests without viewer discovery', async () => {
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  const shell = host.querySelector('.ui-workspace-tabs');
  expect(shell).not.toBeNull();
  expect(requests).toHaveLength(1);
  expect(requests[0].name).toBe('journeyWorkspaceQuery');
  await act(async () => requests[0].next({ viewer, group }));
  expect(host.textContent).toContain('Private member');
  search = 'tab=activity';
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  expect(host.querySelector('.ui-workspace-tabs')).toBe(shell);
  expect(host.textContent).not.toContain('Private member');
  expect(host.textContent).not.toContain('Private group');
  expect(requests).toHaveLength(2);
  expect(requests[0].canceled).toBe(true);
  expect(requests[1].variables).toMatchObject({
    activity: true,
    ledger: false,
    overview: false,
    balances: false,
    summary: false,
  });
  await act(async () => requests[0].next({ viewer, group }));
  expect(host.textContent).not.toContain('Private member');
  await act(async () =>
    requests[1].next({
      viewer,
      group: { __typename: 'Problem', code: 'NOT_FOUND', message: 'denied' },
      groupActivity: { __typename: 'Problem', code: 'NOT_FOUND' },
    }),
  );
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.textContent).not.toContain('Private group');
  expect(host.querySelector('.ui-workspace-tabs')).toBe(shell);
});
it('consumes the composed Activity result without a second dedicated read and coalesces foreground authorization', async () => {
  search = 'tab=activity';
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  await act(async () =>
    requests[0].next({
      viewer,
      group,
      groupActivity: {
        __typename: 'ActivityConnection',
        edges: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    }),
  );
  expect(host.textContent).toContain('No activity');
  expect(requests).toHaveLength(1);
  act(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
  });
  expect(host.textContent).not.toContain('Private group');
  expect(host.textContent).not.toContain('No activity');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(requests).toHaveLength(2);
  expect(requests[0].canceled).toBe(true);
});
it('rapid Activity to Members to Activity navigation rejects out-of-order private responses', async () => {
  search = 'tab=activity';
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  const shell = host.querySelector('.ui-workspace-tabs');
  search = 'tab=members';
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  search = 'tab=activity';
  await act(async () => root.render(<GroupJourney initialGroup="G" />));
  expect(requests).toHaveLength(3);
  expect(requests.slice(0, 2).every((request) => request.canceled)).toBe(true);
  await act(async () =>
    requests[2].next({
      viewer,
      group: { __typename: 'Problem', code: 'NOT_FOUND', message: 'denied' },
      groupActivity: { __typename: 'Problem', code: 'NOT_FOUND' },
    }),
  );
  await act(async () => {
    requests[1].next({ viewer, group });
    requests[0].next({
      viewer,
      group,
      groupActivity: {
        __typename: 'ActivityConnection',
        edges: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });
  });
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.textContent).not.toContain('Private member');
  expect(host.textContent).not.toContain('Private group');
  expect(host.textContent).not.toContain('No activity');
  expect(host.querySelector('.ui-workspace-tabs')).toBe(shell);
  expect(
    host.querySelector('.ui-workspace-tabs a[aria-current="page"]')
      ?.textContent,
  ).toBe('Activity');
});
