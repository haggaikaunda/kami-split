import { afterEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createOperationDescriptor,
  RecordSource,
  fetchQuery,
  commitMutation,
} from 'relay-runtime';
import { createScope, type FinancialScope } from './environment';
import { workspaceFetchPolicy } from './query';
import expenseQuery, {
  type journeyExpenseQuery,
} from './__generated__/journeyExpenseQuery.graphql';
import accessQuery, {
  type householdAccessQuery,
} from './__generated__/householdAccessQuery.graphql';
import recoveryQuery, {
  type journeyRecoveryQuery,
} from './__generated__/journeyRecoveryQuery.graphql';
import createMutation, {
  type journeyCreateMutation,
} from './__generated__/journeyCreateMutation.graphql';

const scopes: FinancialScope[] = [];
const session = {
  data: { session: { user: { id: 'actor' }, access_token: 'synthetic' } },
  error: null,
};
function scope(
  onDenied = vi.fn(),
  getSession = vi.fn().mockResolvedValue(session),
) {
  const value = createScope(
    { auth: { getSession } } as unknown as SupabaseClient,
    'actor',
    onDenied,
  );
  scopes.push(value);
  return value;
}
const body = {
  data: {
    viewer: {
      __typename: 'Viewer',
      id: 'actor-node',
      groups: [{ id: 'H', isHousehold: true }],
    },
  },
};
const response = () => new Response(JSON.stringify(body), { status: 200 });
const operation = createOperationDescriptor(accessQuery, {});
function read(value: FinancialScope, fresh = false) {
  return fetchQuery<householdAccessQuery>(
    value.environment,
    accessQuery,
    {},
    {
      fetchPolicy: fresh
        ? 'network-only'
        : workspaceFetchPolicy(value.environment, accessQuery, {}),
    },
  ).toPromise();
}
async function retainRead(value: FinancialScope) {
  const retained = value.environment.retain(operation);
  await read(value);
  retained.dispose();
}
afterEach(() => {
  scopes.splice(0).forEach((value) => value.dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('real Relay released queries reuse complete data until consumption at 30 seconds, without polling', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
  const fetch = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetch);
  const value = scope();
  await retainRead(value);
  now.mockReturnValue(129_999);
  await retainRead(value);
  expect(fetch).toHaveBeenCalledTimes(1);
  now.mockReturnValue(130_001);
  expect(fetch).toHaveBeenCalledTimes(1);
  await retainRead(value);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('missing records and explicit invalidation force a server read inside the window', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(100_000);
  const fetch = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetch);
  const value = scope();
  await retainRead(value);
  value.environment.commitUpdate((store) =>
    store.get('GroupSummary:H')?.setValue(undefined, 'isHousehold'),
  );
  await retainRead(value);
  expect(fetch).toHaveBeenCalledTimes(2);
  value.invalidate();
  await retainRead(value);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it.each([
  ['HTTP401 malformed body', () => new Response('not json', { status: 401 })],
  ['HTTP403', () => new Response('{}', { status: 403 })],
  ['HTTP404 masked', () => new Response('{}', { status: 404 })],
  [
    'domain denied',
    () =>
      new Response(
        JSON.stringify({
          data: { viewer: { __typename: 'Problem', code: 'FORBIDDEN' } },
        }),
      ),
  ],
  [
    'domain masked missing',
    () =>
      new Response(
        JSON.stringify({
          data: { viewer: { __typename: 'Problem', code: 'NOT_FOUND' } },
        }),
      ),
  ],
  [
    'GraphQL authentication',
    () =>
      new Response(
        JSON.stringify({
          errors: [
            { message: 'denied', extensions: { code: 'UNAUTHENTICATED' } },
          ],
        }),
      ),
  ],
] as const)(
  '%s purges cached records and prevents subsequent reuse',
  async (_name, deniedResponse) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockImplementationOnce(async () => deniedResponse());
    vi.stubGlobal('fetch', fetch);
    const denied = vi.fn();
    const value = scope(denied);
    await retainRead(value);
    expect(
      value.environment.getStore().getSource().get('GroupSummary:H'),
    ).toBeDefined();
    await expect(read(value, true)).rejects.toThrow();
    expect(value.isLive()).toBe(false);
    expect(
      value.environment.getStore().getSource().getRecordIDs(),
    ).toHaveLength(0);
    expect(denied).toHaveBeenCalledTimes(1);
  },
);

it('transport failure and recovery NOT_FOUND preserve the account scope', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            expenseOperation: {
              __typename: 'Problem',
              code: 'NOT_FOUND',
              message: 'not observed',
            },
          },
        }),
      ),
    );
  vi.stubGlobal('fetch', fetch);
  const value = scope();
  await retainRead(value);
  await expect(read(value, true)).rejects.toThrow('offline');
  await fetchQuery<journeyRecoveryQuery>(
    value.environment,
    recoveryQuery,
    { groupId: 'H', key: 'attempt' },
    { fetchPolicy: 'network-only' },
  ).toPromise();
  expect(value.isLive()).toBe(true);
  expect(
    value.environment.getStore().getSource().get('GroupSummary:H'),
  ).toBeDefined();
});

it('canceling a query while session lookup is pending does not revoke a healthy account', async () => {
  const auth = Promise.withResolvers<typeof session>();
  const value = scope(vi.fn(), vi.fn().mockReturnValue(auth.promise));
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const subscription = fetchQuery<householdAccessQuery>(
    value.environment,
    accessQuery,
    {},
  ).subscribe({});
  subscription.unsubscribe();
  auth.resolve(session);
  await auth.promise;
  await Promise.resolve();
  expect(value.isLive()).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it('successful financial writes invalidate cached reads and reject a pending pre-write read', async () => {
  const late = Promise.withResolvers<Response>();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockReturnValueOnce(late.promise)
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            createExpense: {
              __typename: 'ExpenseCommitted',
              key: 'attempt',
              record: {
                expenseId: 'e',
                groupId: 'H',
                revision: '2',
                split: 'EQUAL',
                totalMinor: '300',
                allocations: [
                  {
                    participantId: 'm',
                    amountMinor: '300',
                    percentageHundredths: null,
                  },
                ],
              },
            },
          },
        }),
      ),
    )
    .mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetch);
  const value = scope();
  await retainRead(value);
  const pending = read(value, true);
  const rejected = expect(pending).rejects.toThrow('READ_INVALIDATED');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await new Promise<void>((resolve, reject) =>
    commitMutation<journeyCreateMutation>(value.environment, {
      mutation: createMutation,
      variables: {
        input: {
          groupId: 'H',
          key: 'attempt',
          category: 'OTHER',
          currency: 'USD',
          description: 'Lunch',
          effectiveDate: '2026-10-01',
          participantIds: ['m'],
          payerId: 'm',
          split: 'EQUAL',
          totalMinor: '300',
        },
      },
      onCompleted: () => resolve(),
      onError: reject,
    }),
  );
  expect(value.environment.check(operation).status).toBe('stale');
  late.resolve(response());
  await rejected;
  await retainRead(value);
  expect(fetch).toHaveBeenCalledTimes(4);
});

it('denial guards a concurrent late response and isolates the next account environment', async () => {
  const late = Promise.withResolvers<Response>();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockReturnValueOnce(late.promise)
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            expenseOperation: {
              __typename: 'Problem',
              code: 'FORBIDDEN',
              message: 'denied',
            },
          },
        }),
      ),
    );
  vi.stubGlobal('fetch', fetch);
  const value = scope();
  await retainRead(value);
  const pending = read(value, true);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await expect(
    fetchQuery<journeyRecoveryQuery>(
      value.environment,
      recoveryQuery,
      { groupId: 'H', key: 'attempt' },
      { fetchPolicy: 'network-only' },
    ).toPromise(),
  ).rejects.toThrow('FORBIDDEN');
  late.resolve(response());
  await rejected;
  expect(value.environment.getStore().getSource().getRecordIDs()).toHaveLength(
    0,
  );
  const next = createScope(
    { auth: { getSession: vi.fn() } } as unknown as SupabaseClient,
    'other',
  );
  scopes.push(next);
  expect(
    next.environment.getStore().getSource().get('GroupSummary:H'),
  ).toBeUndefined();
});

it('expiry remains enforced when the expired retained visit releases immediately before the next visit', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
  const fetch = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetch);
  const value = scope();
  const retained = value.environment.retain(operation);
  await read(value);
  now.mockReturnValue(130_001);
  retained.dispose();
  await retainRead(value);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('complete normalized data without an observed fetch timestamp is not eligible for reuse', async () => {
  const fetch = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetch);
  const value = scope();
  const normalized = scope();
  normalized.environment.commitPayload(operation, body.data);
  value.environment
    .getStore()
    .publish(
      new RecordSource(normalized.environment.getStore().getSource().toJSON()),
    );
  expect(value.environment.check(operation)).toEqual({
    status: 'available',
    fetchTime: null,
  });
  await retainRead(value);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('a genuine empty authorized result is reusable and never treated as denial', async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          viewer: { __typename: 'Viewer', id: 'actor-node', groups: [] },
        },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  const denied = vi.fn();
  const value = scope(denied);
  await retainRead(value);
  await retainRead(value);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(value.isLive()).toBe(true);
  expect(denied).not.toHaveBeenCalled();
});

it('an HTTP denial arriving after disposal cannot notify and revoke a replacement account scope', async () => {
  const late = Promise.withResolvers<Response>();
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(late.promise));
  const denied = vi.fn();
  const value = scope(denied);
  const pending = read(value, true);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  value.dispose();
  late.resolve(new Response('late old request', { status: 401 }));
  await rejected;
  expect(denied).not.toHaveBeenCalled();
});

it('recovering a committed write invalidates every retained read without changing recovery success', async () => {
  const committed = {
    __typename: 'ExpenseCommitted',
    key: 'attempt',
    record: {
      expenseId: 'e',
      groupId: 'H',
      revision: '2',
      split: 'EQUAL',
      totalMinor: '300',
      allocations: [
        { participantId: 'm', amountMinor: '300', percentageHundredths: null },
      ],
    },
  };
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { expenseOperation: committed } })),
      ),
  );
  const value = scope();
  await retainRead(value);
  const recovered = await fetchQuery<journeyRecoveryQuery>(
    value.environment,
    recoveryQuery,
    { groupId: 'H', key: 'attempt' },
    { fetchPolicy: 'network-only' },
  ).toPromise();
  expect(recovered?.expenseOperation.__typename).toBe('ExpenseCommitted');
  expect(value.environment.check(operation).status).toBe('stale');
  expect(value.isLive()).toBe(true);
});

it('a masked missing Node evicts prior financial data while a Node field transport error stays distinct', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { node: null },
          errors: [{ message: 'temporary resolver failure', path: ['node'] }],
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { node: null } })),
    );
  vi.stubGlobal('fetch', fetch);
  const value = scope();
  await retainRead(value);
  await fetchQuery<journeyExpenseQuery>(
    value.environment,
    expenseQuery,
    { id: 'missing' },
    { fetchPolicy: 'network-only' },
  ).toPromise();
  expect(value.isLive()).toBe(true);
  expect(
    value.environment.getStore().getSource().get('GroupSummary:H'),
  ).toBeDefined();
  await expect(
    fetchQuery<journeyExpenseQuery>(
      value.environment,
      expenseQuery,
      { id: 'missing' },
      { fetchPolicy: 'network-only' },
    ).toPromise(),
  ).rejects.toThrow('NOT_FOUND');
  expect(value.isLive()).toBe(false);
  expect(value.environment.getStore().getSource().getRecordIDs()).toHaveLength(
    0,
  );
});
