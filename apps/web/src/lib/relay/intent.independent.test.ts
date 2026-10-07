import { afterEach, expect, it, vi } from 'vitest';
import { fetchQuery, type OperationType } from 'relay-runtime';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createScope } from './environment';
import { createWorkspaceIntent } from './intent';
import { workspaceRequest } from './workspace-request';
const session = {
  data: { session: { user: { id: 'actor' }, access_token: 'synthetic' } },
  error: null,
};
const scopes: ReturnType<typeof createScope>[] = [];
function scopeFor(getSession = async () => session) {
  const scope = createScope(
    { auth: { getSession } } as unknown as SupabaseClient,
    'actor',
  );
  scopes.push(scope);
  return scope;
}
afterEach(() => {
  scopes.forEach((s) => s.dispose());
  scopes.length = 0;
  vi.unstubAllGlobals();
});
it('coalesces pointer/focus intent, cancels its actual network request, and reads fresh on activation', async () => {
  const pending: { signal: AbortSignal; resolve(response: Response): void }[] =
    [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve) =>
          pending.push({ signal: init.signal!, resolve }),
        ),
    ),
  );
  const scope = scopeFor();
  const intent = createWorkspaceIntent(scope);
  const request = workspaceRequest('private-group', 'members');
  intent.warm(request);
  intent.warm(request);
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  intent.cancel();
  expect(pending[0].signal.aborted).toBe(true);
  const visit = fetchQuery<OperationType>(
    scope.environment,
    request.document,
    request.variables,
    { fetchPolicy: 'network-only' },
  ).toPromise();
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  pending[0].resolve(
    new Response(
      JSON.stringify({
        data: {
          viewer: { __typename: 'Viewer', today: '2026-10-05' },
          group: { __typename: 'Problem', code: 'OLD', message: 'old' },
        },
      }),
    ),
  );
  pending[1].resolve(
    new Response(
      JSON.stringify({
        data: {
          viewer: { __typename: 'Viewer', today: '2026-10-05' },
          group: {
            __typename: 'Problem',
            code: 'FORBIDDEN',
            message: 'denied',
          },
        },
      }),
    ),
  );
  expect(await visit).toMatchObject({ group: { code: 'FORBIDDEN' } });
});
it('does not start abandoned intent transport after asynchronous session lookup completes', async () => {
  let release!: (value: typeof session) => void;
  const scope = scopeFor(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const intent = createWorkspaceIntent(scope);
  intent.warm(workspaceRequest('private-group', 'members'));
  intent.cancel();
  release(session);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetch).not.toHaveBeenCalled();
});
it('releases superseded candidates and refuses warm work after account disposal', async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      return new Promise(() => {});
    }),
  );
  const scope = scopeFor(),
    intent = createWorkspaceIntent(scope);
  intent.warm(workspaceRequest('A', 'members'));
  await vi.waitFor(() => expect(signals).toHaveLength(1));
  intent.warm(workspaceRequest('B', 'activity'));
  await vi.waitFor(() => expect(signals).toHaveLength(2));
  expect(signals[0].aborted).toBe(true);
  scope.dispose();
  expect(signals[1].aborted).toBe(true);
  intent.warm(workspaceRequest('C', 'expenses'));
  await Promise.resolve();
  expect(signals).toHaveLength(2);
});
it('old-link blur cannot cancel the newly hovered candidate or duplicate its focus request', async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      return new Promise(() => {});
    }),
  );
  const scope = scopeFor(),
    intent = createWorkspaceIntent(scope);
  const old = workspaceRequest('A', 'members'),
    current = workspaceRequest('A', 'activity');
  intent.warm(old);
  await vi.waitFor(() => expect(signals).toHaveLength(1));
  intent.warm(current);
  await vi.waitFor(() => expect(signals).toHaveLength(2));
  intent.cancel(old.key);
  intent.warm(current);
  await Promise.resolve();
  expect(signals).toHaveLength(2);
  expect(signals[1].aborted).toBe(false);
  intent.cancel(current.key);
  expect(signals[1].aborted).toBe(true);
});
