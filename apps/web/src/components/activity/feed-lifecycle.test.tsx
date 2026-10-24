// @vitest-environment jsdom
import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { queryEnvironment, relayRoot } from '@/lib/relay/test-queries';
import type { FinancialScope } from '@/lib/relay/environment';
import { ActivityFeed } from './feed';
import { fetchQuery } from 'relay-runtime';
import groupDocument, {
  type activityGroupQuery,
} from '@/lib/relay/__generated__/activityGroupQuery.graphql';
vi.mock('next/link', () => ({
  default: 'a',
  useLinkStatus: () => ({ pending: false }),
}));
let root: Root | undefined, host: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  vi.restoreAllMocks();
});
it('commits the actual complete cached Activity connection directly and retains its exact filter', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const requests: Parameters<Parameters<typeof queryEnvironment>[0]>[0][] = [];
  const scope = {
    id: 'actor',
    isLive: () => true,
    environment: queryEnvironment((request) => requests.push(request)),
  } as FinancialScope;
  host = document.createElement('div');
  document.body.append(host);
  root = relayRoot(createRoot(host), () => scope);
  await act(async () =>
    root!.render(<ActivityFeed scope={scope} groupId="" />),
  );
  await act(async () =>
    requests[0].next({
      householdActivity: {
        __typename: 'ActivityConnection',
        edges: [
          {
            cursor: 'event-cursor',
            node: {
              __typename: 'ActivityEvent',
              id: 'event',
              recordId: 'expense',
              description: 'Lunch',
              note: null,
              before: null,
              after: null,
              kind: 'EXPENSE_CREATED',
              groupId: 'group',
              groupName: 'Home',
              groupKind: 'ORDINARY',
              isHousehold: true,
              amountMinor: '9007199254740993',
              currency: 'USD',
              effectiveDate: '2026-10-01',
              timestamp: '2026-10-01T12:00:00Z',
              creator: { id: 'member', displayName: 'Alice' },
              payer: { id: 'member', displayName: 'Alice' },
              sender: null,
              recipient: null,
            },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: 'event-cursor' },
      },
    }),
  );
  await act(async () => root!.render(null));
  const commits: string[] = [];
  await act(async () =>
    root!.render(
      <Profiler
        id="activity"
        onRender={() => commits.push(host.textContent ?? '')}
      >
        <ActivityFeed scope={scope} groupId="" />
      </Profiler>,
    ),
  );
  expect(commits.length).toBeGreaterThan(0);
  expect(commits.every((text) => text.includes('Alice'))).toBe(true);
  expect(host.textContent).toContain('90,071,992,547,409.93');
  expect(requests).toHaveLength(1);
  expect(requests[0].variables).toEqual({
    after: null,
    filter: { kind: null, sourceGroupId: null },
  });
});

it('never recommits an expired initial feed when a filtered visit returns to the unfiltered URL', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let now = 100_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const requests: Parameters<Parameters<typeof queryEnvironment>[0]>[0][] = [];
  const scope = {
    id: 'actor',
    isLive: () => true,
    environment: queryEnvironment((request) => requests.push(request)),
  } as FinancialScope;
  const connection = (id: string, description: string, kind: string) => ({
    __typename: 'ActivityConnection',
    edges: [
      {
        cursor: id,
        node: {
          __typename: 'ActivityEvent',
          id,
          recordId: 'expense-' + id,
          description,
          note: null,
          before: null,
          after: null,
          kind,
          groupId: 'group',
          groupName: 'Home',
          groupKind: 'ORDINARY',
          isHousehold: false,
          amountMinor: '1234',
          currency: 'USD',
          effectiveDate: '2026-10-01',
          timestamp: '2026-10-01T12:00:00Z',
          creator: { id: 'member', displayName: 'Alice' },
          payer: { id: 'member', displayName: 'Alice' },
          sender: null,
          recipient: null,
        },
      },
    ],
    pageInfo: { hasNextPage: false, endCursor: id },
  });
  const priming = fetchQuery<activityGroupQuery>(
    scope.environment,
    groupDocument,
    {
      groupId: 'group',
      after: null,
      filter: { kind: null, sourceGroupId: null },
    },
    { fetchPolicy: 'network-only' },
  ).toPromise();
  requests[0].next({
    groupActivity: connection(
      'initial',
      'Original unfiltered private row',
      'EXPENSE_UPDATED',
    ),
  });
  const initialFeed = (await priming)!.groupActivity;
  host = document.createElement('div');
  document.body.append(host);
  root = relayRoot(createRoot(host), () => scope);
  const commits: string[] = [];
  const render = (kind: string) =>
    root!.render(
      <Profiler
        id="filtered-activity"
        onRender={() => commits.push(host.textContent ?? '')}
      >
        <ActivityFeed
          scope={scope}
          groupId="group"
          initialFeed={initialFeed}
          kind={kind}
          onKindChange={() => {}}
        />
      </Profiler>,
    );
  await act(async () => render('EXPENSE_CREATED'));
  expect(requests).toHaveLength(2);
  await act(async () =>
    requests[1].next({
      groupActivity: connection(
        'filtered',
        'Current filtered row',
        'EXPENSE_CREATED',
      ),
    }),
  );
  expect(host.textContent).toContain('Current filtered row');
  expect(host.textContent).not.toContain('Original unfiltered private row');
  now += 31_000;
  commits.length = 0;
  await act(async () => render(''));
  expect(requests).toHaveLength(3);
  expect(requests[2].variables).toEqual({
    groupId: 'group',
    after: null,
    filter: { kind: null, sourceGroupId: null },
  });
  expect(commits.length).toBeGreaterThan(0);
  expect(
    commits.every((text) => !text.includes('Original unfiltered private row')),
  ).toBe(true);
  expect(host.textContent).not.toContain('Current filtered row');
  await act(async () =>
    requests[2].next({
      groupActivity: connection(
        'fresh',
        'Fresh unfiltered row',
        'EXPENSE_CREATED',
      ),
    }),
  );
  expect(host.textContent).toContain('Fresh unfiltered row');
  expect(host.textContent).not.toContain('Original unfiltered private row');
});
