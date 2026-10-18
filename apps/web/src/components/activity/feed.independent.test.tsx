// @vitest-environment jsdom
import { queryEnvironment, relayRoot } from '@/lib/relay/test-queries';
import { act } from 'react';
import { foregroundRefresh } from '../workspace-refresh.test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ActivityFeed } from './feed';
import type { FinancialScope } from '@/lib/relay/environment';
const boundary = vi.hoisted(() => ({
  requests: [] as {
    variables: unknown;
    options?: unknown;
    next?: (value: unknown) => void;
    error?: () => void;
    resolve?: (value: unknown) => void;
    unsubscribe: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock('relay-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('relay-runtime')>()),
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
  description: 'Lunch',
  note: '',
  before: null,
  after: null,
  kind: 'EXPENSE_CREATED',
  creator: { displayName: 'Alice' },
  payer: { displayName: 'Bob' },
  sender: null,
  recipient: null,
  groupId: 'g',
  groupName: 'Trip',
  groupKind: 'TRIP',
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
    environment: queryEnvironment((request) => boundary.requests.push(request)),
    isLive: () => live,
  } as FinancialScope;
  host = document.createElement('div');
  document.body.append(host);
  root = relayRoot(createRoot(host), () => scope);
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
    (b.getAttribute('aria-label') ?? b.textContent)?.includes(label),
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
it('distinguishes loading, empty, filtered empty and unavailable without retaining rows', async () => {
  await render();
  expect(
    host.querySelector(
      '[data-ui="content-loading"][data-layout="activity"] [aria-busy="true"]',
    ),
  ).not.toBeNull();
  await respond(connection([]));
  expect(host.textContent).toContain('No activity yet');
  const select = host.querySelector('select')!;
  await act(async () => {
    select.value = 'REPAYMENT_RECORDED';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await respond(connection([]));
  expect(host.textContent).toContain('No activity matches these filters');
  await foregroundRefresh();
  await act(async () => boundary.requests.at(-1)!.error?.());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'unavailable',
  );
});
it('fresh refresh immediately removes cached rows and ignores superseded responses', async () => {
  await render();
  await respond(connection());
  expect(host.textContent).toContain('Alice');
  await foregroundRefresh();
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
it('reauthorizes the complete source context in event detail and clears revoked history', async () => {
  await render();
  await respond(connection());
  await click('added an expense');
  expect(document.activeElement).toBe(
    host.querySelector('[aria-label="Historical event detail"]'),
  );
  expect(host.textContent).toContain('Loading activity detail');
  expect(boundary.requests).toHaveLength(2);
  await act(async () =>
    boundary.requests[1].resolve?.({
      householdActivity: { __typename: 'AccessError' },
    }),
  );
  expect(boundary.requests).toHaveLength(2);
  expect(host.textContent).not.toContain('Alice');
  expect(host.textContent).toContain('Activity access changed');
  expect(host.querySelector('[data-ui~="activity-detail"]')).toBeNull();
  expect(host.textContent).not.toContain('Trip');
});
it('rejects a detail from a different group and ignores late detail after close', async () => {
  await render();
  await respond(connection());
  await click('added an expense');
  expect(boundary.requests[1].variables).toEqual({
    eventId: 'event',
    groupId: null,
  });
  await click('Close detail');
  await act(async () =>
    boundary.requests[1].resolve?.({
      activityEvent: {
        ...row,
        __typename: 'ActivityEvent',
        groupId: 'other',
        description: 'Private secret',
      },
    }),
  );
  expect(host.textContent).not.toContain('Private secret');
  expect(
    host.querySelector('[aria-label="Historical event detail"]'),
  ).toBeNull();
});
it('keeps keyboard focus on Close while current detail finishes loading', async () => {
  await render();
  await respond(connection());
  await click('added an expense');
  const close = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'Close detail',
  )!;
  close.focus();
  await act(async () =>
    boundary.requests[1].resolve?.({
      activityEvent: {
        ...row,
        __typename: 'ActivityEvent',
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
    (b.getAttribute('aria-label') ?? b.textContent)?.includes(
      'added an expense',
    ),
  )!;
  trigger.focus();
  await click('added an expense');
  await click('Close detail');
  expect(document.activeElement).toBe(trigger);
});
it('removes history when freshly authorized detail belongs to another source group', async () => {
  await render();
  await respond(connection());
  await click('added an expense');
  await act(async () =>
    boundary.requests[1].resolve?.({
      activityEvent: {
        ...row,
        __typename: 'ActivityEvent',
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
  await click('added an expense');
  await act(async () =>
    boundary.requests[1].resolve?.({
      activityEvent: {
        ...row,
        __typename: 'ActivityEvent',
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
  expect(host.querySelector('[data-ui~="activity-detail"]')).toBeNull();
  expect(host.textContent).not.toContain('Sensitive lunch');
  expect(host.textContent).not.toContain('Trip');
  expect(boundary.requests.at(-1)?.variables).toMatchObject({
    after: 'next-cursor',
  });
  await respond({ __typename: 'Problem' });
  expect(host.querySelector('[data-ui~="activity-detail"]')).toBeNull();
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
  expect(
    host.querySelector(
      '[data-ui="content-loading"][data-layout="activity"] [aria-busy="true"]',
    ),
  ).not.toBeNull();
  await respond(connection());
  expect(host.textContent).toContain('Alice');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

for (const source of [
  { id: 'g', kind: 'TRIP', isHousehold: false, href: '/trips/g' },
  { id: 'g', kind: 'ORDINARY', isHousehold: false, href: '/groups/g' },
  { id: 'H', kind: 'ORDINARY', isHousehold: true, href: '/household/ledger' },
])
  it(`opens repayment source through its authorized ${source.kind}/${source.isHousehold} navigation`, async () => {
    await render();
    const event = {
      ...row,
      groupId: source.id,
      groupKind: source.kind,
      isHousehold: source.isHousehold,
      kind: 'REPAYMENT_RECORDED',
      recordId: 'repayment',
      payer: null,
      sender: { id: 'sender', displayName: 'Alice' },
      recipient: { id: 'recipient', displayName: 'Bob' },
    };
    const feed = { ...connection([]), edges: [{ node: event }] };
    await respond(feed);
    await click('recorded a repayment');
    await act(async () =>
      boundary.requests[1].resolve?.({
        activityEvent: {
          ...event,
          __typename: 'ActivityEvent',
          groupId: source.id,
          amountMinor: '101',
          currency: 'USD',
          effectiveDate: '2026-09-01',
        },
      }),
    );
    expect(
      host.querySelector(`a[href="${source.href}?tab=balances"]`)?.textContent,
    ).toContain('View source balances');
    expect(boundary.requests[1].variables).toEqual({
      eventId: 'event',
      groupId: null,
    });
  });

it('separates every event kind from exact money and uses the recorded UTC date', async () => {
  await render();
  await respond({
    ...connection([]),
    edges: [
      { ...row, id: 'created', timestamp: '2026-09-02T23:30:00-07:00' },
      {
        ...row,
        id: 'updated',
        kind: 'EXPENSE_UPDATED',
        description: 'Revised lunch',
      },
      {
        ...row,
        id: 'repayment',
        kind: 'REPAYMENT_RECORDED',
        description: '',
        payer: null,
        sender: { displayName: 'Carol' },
        recipient: { displayName: 'Dave' },
        amountMinor: '9007199254740991',
      },
    ].map((node) => ({ node })),
  });
  const events = [
    ...host.querySelectorAll('[data-ui~="activity-events"] > li'),
  ];
  expect(events).toHaveLength(3);
  expect(
    events.map((event) => event.querySelector('strong')?.textContent),
  ).toEqual([
    'Alice added Lunch',
    'Alice updated Revised lunch',
    'Alice recorded a repayment',
  ]);
  expect(events[0].querySelector('time')?.dateTime).toBe(
    '2026-09-02T23:30:00-07:00',
  );
  expect(events[0].querySelector('time')?.textContent).toBe(
    'Recorded Sep 3, 2026',
  );
  for (const event of events) {
    expect(
      event.querySelector(
        '[data-ui~="activity-row-metadata"] [data-ui~="money"]',
      ),
    ).toBeNull();
    expect(
      event.querySelector(
        '[data-ui~="activity-row-amount"] [data-ui~="money"]',
      ),
    ).not.toBeNull();
    expect(
      event.querySelector('[data-ui~="activity-row-icon"]'),
    ).not.toBeNull();
    expect(event.querySelector('button [tabindex="0"]')).toBeNull();
  }
  expect(
    events[2].querySelector('[data-ui~="activity-row-amount"]')?.textContent,
  ).toContain('90,071,992,547,409.91');
  expect(events[2].querySelector('strong')?.textContent).not.toContain('Carol');
});
