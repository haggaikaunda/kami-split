import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchQuery } from 'relay-runtime';
import viewerQuery, {
  type journeyViewerQuery,
} from './__generated__/journeyViewerQuery.graphql';
import { createScope } from './environment';

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
