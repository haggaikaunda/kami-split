import cancelDocument, {
  type enrollmentCancelMutation,
} from './__generated__/enrollmentCancelMutation.graphql';
import { command } from '@/components/personal/relay-command';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchQuery } from 'relay-runtime';
import viewerQuery, {
  type journeyViewerQuery,
} from './__generated__/journeyViewerQuery.graphql';
import { createScope } from './environment';
import inventoryDocument, {
  type personalInventoryQuery,
} from './__generated__/personalInventoryQuery.graphql';
import timezoneDocument, {
  type reportingTimezoneQuery,
} from './__generated__/reportingTimezoneQuery.graphql';
import recoveryDocument, {
  type enrollmentRecoveryQuery,
} from './__generated__/enrollmentRecoveryQuery.graphql';

const viewerData = {
  data: {
    viewer: {
      __typename: 'Viewer',
      id: 'ks1:User:actor',
      displayName: 'Private person',
      today: '2026-09-30',
      groups: [],
    },
  },
};
function clientFor(getSession: () => Promise<unknown>) {
  return { auth: { getSession } } as unknown as SupabaseClient;
}
const sessionFor = (token = 'first', id = 'actor') => ({
  data: { session: { user: { id }, access_token: token } },
  error: null,
});
function read(scope: ReturnType<typeof createScope>) {
  return fetchQuery<journeyViewerQuery>(
    scope.environment,
    viewerQuery,
    {},
    { fetchPolicy: 'network-only' },
  ).toPromise();
}
afterEach(() => vi.unstubAllGlobals());
describe('independent Relay session isolation', () => {
  it('reads the current access token for every request', async () => {
    const getSession = vi
      .fn()
      .mockResolvedValueOnce(sessionFor('first'))
      .mockResolvedValueOnce(sessionFor('refreshed'));
    const fetch = vi.fn(
      async () => new Response(JSON.stringify(viewerData), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetch);
    const scope = createScope(clientFor(getSession), 'actor');
    await read(scope);
    await read(scope);
    expect(
      fetch.mock.calls.map(
        (call) => (call as unknown as [string, RequestInit])[1].headers,
      ),
    ).toEqual([
      { 'Content-Type': 'application/json', Authorization: 'Bearer first' },
      { 'Content-Type': 'application/json', Authorization: 'Bearer refreshed' },
    ]);
    scope.dispose();
  });
  it('cannot normalize a late response after disposal or share records with a new environment', async () => {
    let release!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const scope = createScope(
      clientFor(async () => sessionFor()),
      'actor',
    );
    const pending = read(scope);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    scope.dispose();
    const fresh = createScope(
      clientFor(async () => sessionFor('new', 'other')),
      'other',
    );
    release(new Response(JSON.stringify(viewerData), { status: 200 }));
    await expect(pending).rejects.toThrow('SESSION_CHANGED');
    expect(
      scope.environment.getStore().getSource().get('ks1:User:actor'),
    ).toBeUndefined();
    expect(
      fresh.environment.getStore().getSource().get('ks1:User:actor'),
    ).toBeUndefined();
    fresh.dispose();
  });
  it('refuses a changed actor before making a network request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const scope = createScope(
      clientFor(async () => sessionFor('other', 'other')),
      'actor',
    );
    await expect(read(scope)).rejects.toThrow('SESSION_CHANGED');
    expect(fetch).not.toHaveBeenCalled();
    scope.dispose();
  });
});

for (const typename of [
  'BankingConnectionsResult',
  'BankingEnrollmentResult',
  'ReportingTimezoneProblem',
])
  it(`evicts private records and notifies the owner on ${typename} access denial`, async () => {
    const onDenied = vi.fn();
    const scope = createScope(
      clientFor(async () => sessionFor()),
      'actor',
      onDenied,
    );
    scope.environment.commitUpdate((store) => {
      store
        .create('private-sentinel', 'BankingAccount')
        .setValue('Private account', 'name');
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                [typename === 'BankingConnectionsResult'
                  ? 'bankingConnections'
                  : typename === 'BankingEnrollmentResult'
                    ? 'bankingEnrollment'
                    : 'reportingTimezone']: {
                  __typename: typename,
                  code: 'FORBIDDEN',
                },
              },
            }),
            { status: 200 },
          ),
      ),
    );
    const pending =
      typename === 'BankingConnectionsResult'
        ? fetchQuery<personalInventoryQuery>(
            scope.environment,
            inventoryDocument,
            { first: 20 },
            { fetchPolicy: 'network-only' },
          ).toPromise()
        : typename === 'BankingEnrollmentResult'
          ? fetchQuery<enrollmentRecoveryQuery>(
              scope.environment,
              recoveryDocument,
              { attemptId: 'opaque' },
              { fetchPolicy: 'network-only' },
            ).toPromise()
          : fetchQuery<reportingTimezoneQuery>(
              scope.environment,
              timezoneDocument,
              {},
              { fetchPolicy: 'network-only' },
            ).toPromise();
    await expect(pending).rejects.toThrow('FORBIDDEN');
    expect(onDenied).toHaveBeenCalledExactlyOnceWith('FORBIDDEN');
    expect(scope.isLive()).toBe(false);
    expect(
      scope.environment.getStore().getSource().get('private-sentinel'),
    ).toBeUndefined();
  });

it('retains the owner scope when enrollment recovery has no receipt yet', async () => {
  const scope = createScope(
    clientFor(async () => sessionFor()),
    'actor',
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              bankingEnrollment: {
                __typename: 'BankingEnrollmentResult',
                code: 'NOT_FOUND',
                state: null,
                attemptId: null,
                connectionId: null,
              },
            },
          }),
          { status: 200 },
        ),
    ),
  );
  const result = await fetchQuery<enrollmentRecoveryQuery>(
    scope.environment,
    recoveryDocument,
    { attemptId: 'opaque' },
    { fetchPolicy: 'network-only' },
  ).toPromise();
  expect(result?.bankingEnrollment.code).toBe('NOT_FOUND');
  expect(scope.isLive()).toBe(true);
  scope.dispose();
});

it.each(['NOT_FOUND', 'FORBIDDEN', 'UNAUTHENTICATED'])(
  'handles enrollment cancellation %s through the actual transport and generated command',
  async (code) => {
    const onDenied = vi.fn();
    const scope = createScope(
      clientFor(async () => sessionFor()),
      'actor',
      onDenied,
    );
    scope.environment.commitUpdate((store) =>
      store
        .create('private-sentinel', 'BankingAccount')
        .setValue('Private account', 'name'),
    );
    const attemptId = '11ef2b3d-90af-4a26-b836-771294c16eab';
    const fetch = vi.fn(async (_url: unknown, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      expect(body.query).toContain('mutation enrollmentCancelMutation');
      expect(body.variables).toEqual({ attemptId });
      return new Response(
        JSON.stringify({
          data: {
            cancelBankingEnrollment: {
              __typename: 'BankingEnrollmentResult',
              code,
              state: null,
              attemptId: null,
              connectionId: null,
            },
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetch);
    const pending = command<enrollmentCancelMutation>(scope, cancelDocument, {
      attemptId,
    });
    if (code === 'NOT_FOUND') {
      await expect(pending).resolves.toMatchObject({
        cancelBankingEnrollment: { code },
      });
      expect(scope.isLive()).toBe(true);
      expect(onDenied).not.toHaveBeenCalled();
      expect(
        scope.environment.getStore().getSource().get('private-sentinel'),
      ).not.toBeUndefined();
    } else {
      await expect(pending).rejects.toThrow(code);
      expect(scope.isLive()).toBe(false);
      expect(onDenied).toHaveBeenCalledExactlyOnceWith(code);
      expect(
        scope.environment.getStore().getSource().get('private-sentinel'),
      ).toBeUndefined();
    }
    scope.dispose();
  },
);

for (const typename of [
  'BankingConnectionResult',
  'BankingManagementResult',
  'BankingReplacementResult',
  'BankingReplacementPreview',
  'BankingReport',
  'BankingTransactionDetail',
])
  it(`clears the entire actor store before a ${typename} management denial can normalize`, async () => {
    const denied = vi.fn();
    const scope = createScope(
      clientFor(async () => sessionFor()),
      'actor',
      denied,
    );
    scope.environment.commitUpdate((store) =>
      store
        .create('private-management-sentinel', 'BankingAccount')
        .setValue('Sensitive connection', 'name'),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                bankingOperation: { __typename: typename, code: 'FORBIDDEN' },
              },
            }),
            { status: 200 },
          ),
      ),
    );
    const { default: document } =
      await import('./__generated__/managementOperationQuery.graphql');
    await expect(
      fetchQuery(
        scope.environment,
        document,
        { attemptId: 'opaque-attempt' },
        { fetchPolicy: 'network-only' },
      ).toPromise(),
    ).rejects.toThrow('FORBIDDEN');
    expect(denied).toHaveBeenCalledExactlyOnceWith('FORBIDDEN');
    expect(scope.isLive()).toBe(false);
    expect(
      scope.environment
        .getStore()
        .getSource()
        .get('private-management-sentinel'),
    ).toBeUndefined();
  });

it('a missing management receipt retains the live actor and never implies rollback', async () => {
  const scope = createScope(
    clientFor(async () => sessionFor()),
    'actor',
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              bankingOperation: {
                __typename: 'BankingManagementResult',
                code: 'NOT_FOUND',
              },
            },
          }),
          { status: 200 },
        ),
    ),
  );
  const { default: document } =
    await import('./__generated__/managementOperationQuery.graphql');
  const result = await fetchQuery(
    scope.environment,
    document,
    { attemptId: 'opaque-attempt' },
    { fetchPolicy: 'network-only' },
  ).toPromise();
  expect(result).toEqual({
    bankingOperation: {
      __typename: 'BankingManagementResult',
      code: 'NOT_FOUND',
    },
  });
  expect(scope.isLive()).toBe(true);
  scope.dispose();
});
