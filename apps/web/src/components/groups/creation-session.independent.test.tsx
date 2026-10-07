// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FinancialSession, useFinancialSession } from './session';
import { groupCreationStorageKey } from '@/lib/relay/draft';
const sdk = vi.hoisted(() => ({
  changed: (_event: string, _session: { user: { id: string } } | null) => {
    void _event;
    void _session;
  },
  actor: 'alice',
}));
vi.mock('@/components/appearance', () => ({
  AppearanceProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/lib/onboarding/client', () => ({
  loadClient: async () => ({
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: sdk.actor } } },
      }),
      onAuthStateChange: (fn: typeof sdk.changed) => {
        sdk.changed = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  }),
}));
let current: ReturnType<typeof useFinancialSession>;
function Probe() {
  const access = useFinancialSession();
  useEffect(() => {
    current = access;
  }, [access]);
  return (
    <p>
      {access.scope
        ? `Private ${access.scope.actor}`
        : (access.error ?? 'No private data')}
    </p>
  );
}
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  sdk.actor = 'alice';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  vi.restoreAllMocks();
  act(() => root.unmount());
  host.remove();
});
async function render() {
  await act(async () =>
    root.render(
      <FinancialSession>
        <Probe />
      </FinancialSession>,
    ),
  );
}
it.each(['SIGNED_OUT', 'SIGNED_IN'])(
  'clears creation recovery before changing actor on %s',
  async (event) => {
    await render();
    const original = current.scope!;
    sessionStorage.setItem(
      groupCreationStorageKey,
      JSON.stringify({
        version: 1,
        actor: 'Viewer:A',
        attempt: { operationKey: 'original-key', name: 'Private creation' },
      }),
    );
    await act(async () =>
      sdk.changed(
        event,
        event === 'SIGNED_OUT' ? null : { user: { id: 'bob' } },
      ),
    );
    expect(sessionStorage.getItem(groupCreationStorageKey)).toBeNull();
    expect(original.isLive()).toBe(false);
    expect(host.textContent).not.toContain('Private alice');
  },
);
