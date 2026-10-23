import reportDocument, {
  type personalTransactionsQuery,
} from './__generated__/personalTransactionsQuery.graphql';
import annotationDocument, {
  type personalTransactionAnnotationMutation,
} from './__generated__/personalTransactionAnnotationMutation.graphql';
import annotationRecoveryDocument, {
  type personalTransactionAnnotationRecoveryQuery,
} from './__generated__/personalTransactionAnnotationRecoveryQuery.graphql';
import selectionDocument, {
  type personalTransactionSelectionQuery,
} from './__generated__/personalTransactionSelectionQuery.graphql';
import { readFresh } from '@/components/personal/relay-command';
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

it.each(['save', 'recovery', 'selection'] as const)(
  'uses typed %s responses to revoke actor access before normalization, preserving domain negatives',
  async (operation) => {
    for (const code of [
      'FORBIDDEN',
      'UNAUTHENTICATED',
      'NOT_FOUND',
      'UNAVAILABLE',
    ]) {
      const denied = vi.fn();
      const scope = createScope(
        clientFor(async () => sessionFor()),
        'actor',
        denied,
      );
      scope.environment.commitUpdate((store) =>
        store
          .create('annotation-private-sentinel', 'BankingAccount')
          .setValue('Private merchant', 'name'),
      );
      const annotation = operation !== 'selection';
      const field =
        operation === 'save'
          ? 'editBankingAnnotation'
          : operation === 'recovery'
            ? 'bankingAnnotationOperation'
            : 'bankingTransaction';
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url, options: RequestInit) => {
          const query = JSON.parse(options.body as string).query;
          expect(query).toContain('__typename');
          return new Response(
            JSON.stringify({
              data: {
                [field]: annotation
                  ? {
                      __typename: 'BankingAnnotationResult',
                      id: 'result',
                      code,
                      sourceId: null,
                      detail: null,
                    }
                  : {
                      __typename: 'BankingTransactionDetail',
                      id: 'detail',
                      code,
                      currentId: null,
                      transaction: null,
                    },
              },
            }),
            { status: 200 },
          );
        }),
      );
      const attemptId = '11ef2b3d-90af-4a26-b836-771294c16eab';
      const pending =
        operation === 'save'
          ? command<personalTransactionAnnotationMutation>(
              scope,
              annotationDocument,
              {
                input: {
                  attemptId,
                  sourceId: 'source',
                  sourceRevision: '1',
                  materialRevision: '1',
                  expectedRevision: '0',
                  field: 'NOTE',
                  value: 'Private intended note',
                },
              },
            )
          : operation === 'recovery'
            ? readFresh<personalTransactionAnnotationRecoveryQuery>(
                scope,
                annotationRecoveryDocument,
                { attemptId },
              )
            : readFresh<personalTransactionSelectionQuery>(
                scope,
                selectionDocument,
                { source: 'source', archive: 'archive' },
              );
      if (code === 'FORBIDDEN' || code === 'UNAUTHENTICATED') {
        await expect(pending).rejects.toThrow(code);
        expect(scope.isLive()).toBe(false);
        expect(denied).toHaveBeenCalledExactlyOnceWith(code);
        expect(
          scope.environment
            .getStore()
            .getSource()
            .get('annotation-private-sentinel'),
        ).toBeUndefined();
      } else {
        await expect(pending).resolves.toMatchObject({ [field]: { code } });
        expect(scope.isLive()).toBe(true);
        expect(denied).not.toHaveBeenCalled();
        expect(
          scope.environment
            .getStore()
            .getSource()
            .get('annotation-private-sentinel'),
        ).toBeDefined();
      }
      scope.dispose();
    }
  },
);

it('revokes actor access on a typed fresh report denial before normalizing private rows', async () => {
  const denied = vi.fn();
  const scope = createScope(
    clientFor(async () => sessionFor()),
    'actor',
    denied,
  );
  scope.environment.commitUpdate((store) =>
    store
      .create('private-report-sentinel', 'BankingAccount')
      .setValue('Private account', 'name'),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              bankingReport: {
                __typename: 'BankingReport',
                id: 'denied-report',
                code: 'FORBIDDEN',
              },
            },
          }),
          { status: 200 },
        ),
    ),
  );
  await expect(
    readFresh<personalTransactionsQuery>(scope, reportDocument, {}),
  ).rejects.toThrow('FORBIDDEN');
  expect(denied).toHaveBeenCalledExactlyOnceWith('FORBIDDEN');
  expect(scope.isLive()).toBe(false);
  expect(
    scope.environment.getStore().getSource().get('private-report-sentinel'),
  ).toBeUndefined();
  scope.dispose();
});

it('relinquishes revoked scope authority once so late denial cannot revoke a later actor', () => {
  const retiredDenied = vi.fn(),
    activeDenied = vi.fn();
  const retired = createScope(
    clientFor(async () => sessionFor()),
    'actor',
    retiredDenied,
  );
  retired.dispose();
  const active = createScope(
    clientFor(async () => sessionFor('new', 'other')),
    'other',
    activeDenied,
  );
  active.environment.commitUpdate((store) =>
    store
      .create('new-actor-private', 'BankingAccount')
      .setValue('Other actor account', 'name'),
  );
  retired.revokeAccess('FORBIDDEN');
  expect(retiredDenied).not.toHaveBeenCalled();
  expect(active.isLive()).toBe(true);
  expect(
    active.environment.getStore().getSource().get('new-actor-private'),
  ).toBeDefined();
  active.revokeAccess('UNAUTHENTICATED');
  active.revokeAccess('FORBIDDEN');
  expect(activeDenied).toHaveBeenCalledExactlyOnceWith('UNAUTHENTICATED');
  expect(
    active.environment.getStore().getSource().get('new-actor-private'),
  ).toBeUndefined();
});
