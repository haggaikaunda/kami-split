import {
  Environment,
  Network,
  RecordSource,
  Store,
  type GraphQLResponse,
} from 'relay-runtime';
import type { SupabaseClient } from '@supabase/supabase-js';
/** No module singleton and no SSR private state. Disposal prevents normalization of late responses. */
export function createScope(client: SupabaseClient, actor: string) {
  let live = true;
  const visits = new Map<
    string,
    { href: string; focus: string; scroll: number; group?: string }
  >();
  const requests = new Set<AbortController>();
  const environment = new Environment({
    network: Network.create(async (operation, variables) => {
      const controller = new AbortController();
      requests.add(controller);
      try {
        const { data, error } = await client.auth.getSession();
        if (!live || error || data.session?.user.id !== actor)
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
        if (!live) throw new Error('SESSION_CHANGED');
        if (!response.ok)
          throw new Error(
            response.status === 401 ? 'UNAUTHENTICATED' : 'UNAVAILABLE',
          );
        // Relay receives partial data AND field errors. A null connection remains failed.
        return result;
      } finally {
        requests.delete(controller);
      }
    }),
    store: new Store(new RecordSource()),
  });
  return {
    actor,
    visits,
    id: crypto.randomUUID(),
    environment,
    isLive: () => live,
    dispose() {
      live = false;
      visits.clear();
      for (const request of requests) request.abort();
      requests.clear();
    },
  };
}
export type FinancialScope = ReturnType<typeof createScope>;
