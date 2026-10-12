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
/** No module singleton and no SSR private state. Disposal prevents normalization of late responses. */
export function createScope(client: SupabaseClient, actor: string) {
  let live = true;
  const restored = new Set<string>();
  const visits = new Map<
    string,
    { href: string; focus: string; scroll: number; group?: string }
  >();
  // Navigation metadata only: private expense rows must be read again after remount.
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
  const restoreHistory = () => {
    const token = window.history.state?.financialRestore;
    if (typeof token === 'string') restored.delete(token);
  };
  if (typeof window !== 'undefined')
    window.addEventListener('popstate', restoreHistory);
  const environment = new Environment({
    network: Network.create((operation, variables) =>
      Observable.create<GraphQLResponse>((sink) => {
        let subscribed = true;
        const controller = new AbortController();
        requests.add(controller);
        void (async () => {
          try {
            if (!operation.text) throw new Error('UNAVAILABLE');
            const { data, error } = await client.auth.getSession();
            if (
              !live ||
              !subscribed ||
              error ||
              data.session?.user.id !== actor
            )
              throw new Error('SESSION_CHANGED');
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
            const result = (await response.json()) as GraphQLResponse;
            if (!live || !subscribed) throw new Error('SESSION_CHANGED');
            if (!response.ok)
              throw new Error(
                response.status === 401 ? 'UNAUTHENTICATED' : 'UNAVAILABLE',
              );
            // Relay receives partial data AND field errors. A null connection remains failed.
            if (subscribed) {
              sink.next(result);
              sink.complete();
            }
          } catch (error) {
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
    store: new Store(new RecordSource()),
  });
  return {
    actor,
    visits,
    expensePositions,
    restored,
    id: createSessionId(),
    environment,
    isLive: () => live,
    dispose() {
      live = false;
      if (typeof window !== 'undefined')
        window.removeEventListener('popstate', restoreHistory);
      visits.clear();
      expensePositions.clear();
      restored.clear();
      for (const request of requests) request.abort();
      requests.clear();
    },
  };
}
export type FinancialScope = ReturnType<typeof createScope>;
