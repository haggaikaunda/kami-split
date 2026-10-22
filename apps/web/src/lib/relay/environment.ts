import { createSessionId } from '@/lib/session-id';
import {
  Environment,
  Observable,
  Network,
  RecordSource,
  Store,
  type GraphQLResponse,
} from 'relay-runtime';
import type { SupabaseClient } from '@supabase/supabase-js';
/** Navigation IDs on non-Node projections must not alias concrete Node records. */
export function financialDataID(
  record: Record<string, unknown>,
  typeName: string,
) {
  // Logical banking account IDs repeat across replacement bindings. Missing
  // stream identity stays parent-scoped rather than aliasing another stream.
  if (typeName === 'BankingAccount')
    return typeof record.streamId === 'string'
      ? `BankingAccount:${record.streamId}`
      : null;
  if (typeof record.id !== 'string') return null;
  return typeName === 'GroupSummary' || typeName === 'ActivityIdentity'
    ? `${typeName}:${record.id}`
    : record.id;
}
/** No module singleton and no SSR private state. Disposal prevents normalization of late responses. */
export function createScope(
  client: SupabaseClient,
  actor: string,
  onDenied?: (code: string) => void,
) {
  const records = new RecordSource();
  let live = true;
  let generation = 0;
  const restored = new Set<string>();
  // UI expansion metadata only. Never retain financial projections here.
  const balanceExpansions = new Map<string, boolean>();
  const visits = new Map<
    string,
    { href: string; focus: string; scroll: number; group?: string }
  >();
  // Navigation metadata only; private data belongs exclusively to Relay.
  const expensePositions = new Map<
    string,
    {
      id: string;
      scroll: number;
      offset: number;
      index: number;
      count: number;
      height: number;
    }
  >();
  const requests = new Set<AbortController>();
  const invalidate = () => {
    generation++;
    environment.commitUpdate((store) => {
      // Relay 20 exposes this public API; its DefinitelyTyped proxy omits it.
      (store as typeof store & { invalidateStore(): void }).invalidateStore();
    });
  };
  const dispose = () => {
    live = false;
    generation++;
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', restoreHistory);
      window.removeEventListener('focus', invalidate);
      window.removeEventListener('pageshow', invalidate);
      window.removeEventListener('workspace-refresh-request', invalidate);
      document.removeEventListener('visibilitychange', invalidate);
    }
    visits.clear();
    expensePositions.clear();
    restored.clear();
    balanceExpansions.clear();
    for (const request of requests) request.abort();
    requests.clear();
    // Erase normalized records as well as preventing all late normalization.
    records.clear();
    environment.getStore().notify();
  };
  const deny = (code: string) => {
    dispose();
    onDenied?.(code);
    return new Error(code);
  };
  const restoreHistory = () => {
    const token = window.history.state?.financialRestore;
    if (typeof token === 'string') restored.delete(token);
  };
  if (typeof window !== 'undefined')
    window.addEventListener('popstate', restoreHistory);
  const environment = new Environment({
    getDataID: financialDataID,
    network: Network.create((operation, variables) =>
      Observable.create<GraphQLResponse>((sink) => {
        let subscribed = true;
        const started = generation;
        const controller = new AbortController();
        requests.add(controller);
        void (async () => {
          try {
            if (!operation.text) throw new Error('UNAVAILABLE');
            const { data, error } = await client.auth.getSession();
            if (!live || !subscribed) throw new Error('SESSION_CHANGED');
            if (error || data.session?.user.id !== actor)
              throw deny('SESSION_CHANGED');
            const response = await fetch('/api/graphql', {
              method: 'POST',
              cache: 'no-store',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${data.session.access_token}`,
              },
              body: JSON.stringify({ query: operation.text, variables }),
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(15000),
              ]),
            });
            if (!live || !subscribed) throw new Error('SESSION_CHANGED');
            if ([401, 403, 404].includes(response.status))
              throw deny(
                response.status === 401 ? 'UNAUTHENTICATED' : 'NOT_FOUND',
              );
            const result = (await response.json()) as GraphQLResponse;
            if (!live || !subscribed) throw new Error('SESSION_CHANGED');
            if (!response.ok)
              throw new Error(
                response.status === 401 ? 'UNAUTHENTICATED' : 'UNAVAILABLE',
              );
            const denied = accessDenial(
              result,
              operation.name.includes('Recovery'),
            );
            if (denied) throw deny(denied);
            if (operation.operationKind === 'query' && started !== generation)
              throw new Error('READ_INVALIDATED');
            // Mutation outcomes may be uncertain: invalidate on every response, including
            // recovery outcomes, without changing their same-attempt protocol.
            if (
              operation.operationKind === 'mutation' ||
              operation.name.includes('Recovery')
            )
              invalidate();
            // Relay receives partial data AND field errors. A null connection remains failed.
            if (subscribed) {
              sink.next(result);
              sink.complete();
            }
          } catch (error) {
            if (live && operation.operationKind === 'mutation') invalidate();
            if (subscribed) sink.error(error as Error);
          } finally {
            requests.delete(controller);
          }
        })();
        return () => {
          subscribed = false;
          controller.abort();
          requests.delete(controller);
        };
      }),
    ),
    store: new Store(records, {
      queryCacheExpirationTime: 30_000,
      gcReleaseBufferSize: 30,
    }),
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', invalidate);
    window.addEventListener('pageshow', invalidate);
    window.addEventListener('workspace-refresh-request', invalidate);
    document.addEventListener('visibilitychange', invalidate);
  }
  return {
    actor,
    visits,
    expensePositions,
    restored,
    balanceExpansions,
    id: createSessionId(),
    environment,
    isLive: () => live,
    invalidate,
    dispose,
  };
}
export type FinancialScope = ReturnType<typeof createScope>;

/** Inspect only typed domain problems and GraphQL error codes, never user text.
 * Recovery NOT_FOUND is an operation outcome, not proof of resource revocation. */
function accessDenial(
  result: GraphQLResponse,
  recovery: boolean,
): string | undefined {
  const visit = (value: unknown): string | undefined => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (
      record.__typename === 'ViewerAccess' &&
      (record.state === 'DISABLED' || record.state === 'UNPROVISIONED')
    )
      return record.state;
    const code = record.code;
    if (
      typeof code === 'string' &&
      (record.__typename === 'Problem' ||
        record.__typename === 'ViewerProblem' ||
        record.__typename === 'ProfileProblem' ||
        record.__typename === 'InvitationProblem' ||
        record.__typename === 'ReportingTimezoneProblem' ||
        record.__typename === 'BankingConnectionsResult' ||
        record.__typename === 'BankingEnrollmentResult')
    ) {
      if (
        [
          'UNAUTHENTICATED',
          'SESSION_CHANGED',
          'DISABLED',
          'UNPROVISIONED',
          'FORBIDDEN',
        ].includes(code) ||
        (code === 'NOT_FOUND' && !recovery)
      )
        return code;
    }
    for (const child of Object.values(record)) {
      const denied = visit(child);
      if (denied) return denied;
    }
  };
  // Node lookup intentionally masks nonexistent and inaccessible resources as null.
  // A field/transport failure is different and must retain its unavailable outcome.
  if (
    'data' in result &&
    result.data?.node === null &&
    (!('errors' in result) || !result.errors?.length) &&
    !recovery
  )
    return 'NOT_FOUND';
  if ('errors' in result) {
    for (const error of result.errors ?? []) {
      const code = (error as typeof error & { extensions?: { code?: unknown } })
        .extensions?.code;
      if (
        typeof code === 'string' &&
        (['UNAUTHENTICATED', 'FORBIDDEN', 'DISABLED', 'UNPROVISIONED'].includes(
          code,
        ) ||
          (code === 'NOT_FOUND' && !recovery))
      )
        return code;
    }
  }
  return visit(result);
}
