// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ActivityFeed } from './feed';
import type { FinancialScope } from '@/lib/relay/environment';
const boundary = vi.hoisted(() => ({
  requests: [] as {
    variables: unknown;
    options: unknown;
    next?: (value: unknown) => void;
    error?: () => void;
    resolve?: (value: unknown) => void;
    unsubscribe: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock('relay-runtime', () => ({
  readInlineData: (_document: unknown, reference: unknown) => reference,
  fetchQuery: (
    _environment: unknown,
    _document: unknown,
    variables: unknown,
    options: unknown,
  ) => {
    const request = {
      variables,
      options,
      unsubscribe: vi.fn(),
    } as (typeof boundary.requests)[number];
    boundary.requests.push(request);
    return {
      subscribe: (observer: {
        next: (value: unknown) => void;
        error: () => void;
      }) => {
        Object.assign(request, observer);
        return { unsubscribe: request.unsubscribe };
      },
      toPromise: () =>
        new Promise((resolve) => {
          request.resolve = resolve;
        }),
    };
  },
}));
const row = {
  id: 'event',
  kind: 'EXPENSE_CREATED',
  creator: { displayName: 'Alice' },
  payer: { displayName: 'Bob' },
  sender: null,
  recipient: null,
  groupId: 'g',
  groupName: 'Trip',
  isHousehold: false,
  effectiveDate: '2026-09-01',
  timestamp: '2026-09-02T12:00:00Z',
  amountMinor: '101',
  currency: 'USD',
  recordId: 'expense',
};
const connection = (rows = [row]) => ({
  __typename: 'ActivityConnection',
  edges: rows.map((node) => ({ node })),
  pageInfo: { hasNextPage: false, endCursor: null },
});
let root: Root, host: HTMLDivElement, live: boolean, scope: FinancialScope;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  boundary.requests.length = 0;
  live = true;
  scope = {
    id: 'alice',
    environment: {},
    isLive: () => live,
  } as FinancialScope;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function render() {
  await act(async () => root.render(<ActivityFeed scope={scope} groupId="" />));
}
async function respond(value: unknown, index = boundary.requests.length - 1) {
  await act(async () =>
    boundary.requests[index].next?.({ householdActivity: value }),
  );
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(label),
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
it('distinguishes loading, empty, filtered empty and unavailable without retaining rows', async () => {
  await render();
  expect(host.textContent).toContain('Loading activity');
  await respond(connection([]));
  expect(host.textContent).toContain('No activity yet');
  const select = host.querySelector('select')!;
  await act(async () => {
    select.value = 'REPAYMENT_RECORDED';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await respond(connection([]));
  expect(host.textContent).toContain('No activity matches these filters');
  await click('Refresh activity');
  await act(async () => boundary.requests.at(-1)!.error?.());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'unavailable',
  );
});
it('fresh refresh immediately removes cached rows and ignores superseded responses', async () => {
  await render();
  await respond(connection());
  expect(host.textContent).toContain('Alice');
  await click('Refresh activity');
  expect(host.textContent).not.toContain('Alice');
  expect(boundary.requests[0].unsubscribe).toHaveBeenCalled();
  expect(boundary.requests[1].options).toEqual({ fetchPolicy: 'network-only' });
  await respond(connection(), 0);
  expect(host.textContent).not.toContain('Alice');
  await respond({ __typename: 'AccessError' });
  expect(host.textContent).not.toContain('Alice');
  expect(host.textContent).toContain('Your access');
});
it('ignores a disposed account scope response and unsubscribes on unmount', async () => {
  await render();
  live = false;
  await respond(connection());
  expect(host.textContent).not.toContain('Alice');
  await act(async () => root.render(null));
  expect(boundary.requests[0].unsubscribe).toHaveBeenCalled();
});
it('reauthorizes the source feed before fetching detail and clears revoked history', async () => {
  await render();
  await respond(connection());
  await click('Expense created');
  expect(document.activeElement).toBe(
    host.querySelector('[aria-label="Current record detail"]'),
  );
  expect(host.textContent).toContain('Checking current record access');
  expect(boundary.requests).toHaveLength(2);
  await act(async () =>
    boundary.requests[1].resolve?.({
      householdActivity: { __typename: 'AccessError' },
    }),
  );
  expect(boundary.requests).toHaveLength(2);
  expect(host.textContent).not.toContain('Alice');
  expect(host.textContent).toContain('Activity access changed');
  expect(host.querySelector('.activity-detail')).toBeNull();
  expect(host.textContent).not.toContain('Trip');
});
it('rejects a detail from a different group and ignores late detail after close', async () => {
  await render();
  await respond(connection());
  await click('Expense created');
  await act(async () =>
    boundary.requests[1].resolve?.({ householdActivity: connection() }),
  );
  expect(boundary.requests[2].variables).toEqual({ id: 'expense' });
  await click('Close detail');
  await act(async () =>
    boundary.requests[2].resolve?.({
      node: {
        __typename: 'Expense',
        groupId: 'other',
        description: 'Private secret',
      },
    }),
  );
  expect(host.textContent).not.toContain('Private secret');
  expect(host.querySelector('[aria-label="Current record detail"]')).toBeNull();
});
it('keeps keyboard focus on Close while current detail finishes loading', async () => {
  await render();
  await respond(connection());
  await click('Expense created');
  await act(async () =>
    boundary.requests[1].resolve?.({ householdActivity: connection() }),
  );
  const close = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'Close detail',
  )!;
  close.focus();
  await act(async () =>
    boundary.requests[2].resolve?.({
      node: {
        __typename: 'Expense',
        groupId: 'g',
        description: 'Lunch',
        totalMinor: '101',
        currency: 'USD',
        effectiveDate: '2026-09-01',
      },
    }),
  );
  expect(document.activeElement).toBe(close);
});
it('restores keyboard focus to the source row when detail closes', async () => {
  await render();
  await respond(connection());
  const trigger = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Expense created'),
  )!;
  trigger.focus();
  await click('Expense created');
  await click('Close detail');
  expect(document.activeElement).toBe(trigger);
});
it('removes history when freshly authorized detail belongs to another source group', async () => {
  await render();
  await respond(connection());
  await click('Expense created');
  await act(async () =>
    boundary.requests[1].resolve?.({ householdActivity: connection() }),
  );
  await act(async () =>
    boundary.requests[2].resolve?.({
      node: {
        __typename: 'Expense',
        groupId: 'other',
        description: 'Private secret',
      },
    }),
  );
  expect(host.textContent).not.toContain('Private secret');
  expect(host.textContent).not.toContain('Alice');
  expect(host.textContent).toContain('Activity access changed');
});

it('removes current detail and source identity before paging reauthorization and keeps them absent on denial', async () => {
  await render();
  const page = {
    ...connection(),
    pageInfo: { hasNextPage: true, endCursor: 'next-cursor' },
  };
  await respond(page);
  await click('Expense created');
  await act(async () =>
    boundary.requests[1].resolve?.({ householdActivity: page }),
  );
  await act(async () =>
    boundary.requests[2].resolve?.({
      node: {
        __typename: 'Expense',
        groupId: 'g',
        description: 'Sensitive lunch',
        totalMinor: '101',
        currency: 'USD',
        effectiveDate: '2026-09-01',
      },
    }),
  );
  expect(host.textContent).toContain('Sensitive lunch');
  await click('Next activity page');
  expect(host.querySelector('.activity-detail')).toBeNull();
  expect(host.textContent).not.toContain('Sensitive lunch');
  expect(host.textContent).not.toContain('Trip');
  expect(boundary.requests.at(-1)?.variables).toMatchObject({
    after: 'next-cursor',
  });
  await respond({ __typename: 'Problem' });
  expect(host.querySelector('.activity-detail')).toBeNull();
  expect(host.textContent).not.toContain('Trip');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'unavailable',
  );
});
it('focus refresh recovers from an unavailable response with freshly authorized rows', async () => {
  await render();
  await act(async () => boundary.requests[0].error?.());
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => window.dispatchEvent(new Event('focus')));
  await act(
    async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain('Loading activity');
  await respond(connection());
  expect(host.textContent).toContain('Alice');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
