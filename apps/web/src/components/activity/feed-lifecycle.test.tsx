// @vitest-environment jsdom
import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { queryEnvironment, relayRoot } from '@/lib/relay/test-queries';
import type { FinancialScope } from '@/lib/relay/environment';
import { ActivityFeed } from './feed';
vi.mock('next/link', () => ({
  default: 'a',
  useLinkStatus: () => ({ pending: false }),
}));
let root: Root | undefined, host: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
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
