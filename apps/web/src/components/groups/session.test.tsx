// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FinancialSession, useFinancialSession } from './session';
import { privateStorageKey } from '@/lib/relay/draft';
const sdk = vi.hoisted(() => ({
  changed: (_event: string, _session: { user: { id: string } } | null) => {
    void _event;
    void _session;
  },
  actor: 'alice',
  expires: 0,
  checked: vi.fn(),
}));
vi.mock('@/components/appearance', () => ({
  AppearanceProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/lib/onboarding/client', () => ({
  loadClient: async () => ({
    auth: {
      getUser: sdk.checked,
      getSession: async () => ({
        data: { session: { user: { id: sdk.actor }, expires_at: sdk.expires } },
      }),
      onAuthStateChange: (fn: typeof sdk.changed) => {
        sdk.changed = (event, session) => {
          sdk.actor = session?.user.id ?? '';
          fn(event, session);
        };
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
  sdk.expires = 0;
  sdk.checked
    .mockReset()
    .mockImplementation(async () => ({ data: { user: { id: sdk.actor } } }));
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
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
it('disposes private memory even when logout storage cleanup throws', async () => {
  await render();
  const original = current.scope!;
  sessionStorage.setItem(privateStorageKey, '{}');
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new DOMException('Blocked', 'SecurityError');
  });
  await act(async () => sdk.changed('SIGNED_OUT', null));
  expect(original.isLive()).toBe(false);
  expect(current.scope).toBeUndefined();
  expect(host.textContent).not.toContain('Private alice');
  expect(host.textContent).toContain('Private storage is unavailable');
  vi.restoreAllMocks();
  await act(async () => {
    sdk.changed('SIGNED_IN', { user: { id: 'alice' } });
    await vi.runAllTimersAsync();
  });
  expect(sessionStorage.getItem(privateStorageKey)).toBeNull();
  expect(current.scope?.id).not.toBe(original.id);
});
it('replaces the environment and clears private drafts on switch and same-account logout/login', async () => {
  await render();
  const original = current.scope!;
  sessionStorage.setItem(privateStorageKey, '{}');
  await act(async () => {
    sdk.changed('SIGNED_IN', { user: { id: 'bob' } });
    await vi.runAllTimersAsync();
  });
  expect(original.isLive()).toBe(false);
  expect(current.scope!.actor).toBe('bob');
  expect(current.scope!.environment).not.toBe(original.environment);
  expect(sessionStorage.getItem(privateStorageKey)).toBeNull();
  const bob = current.scope!;
  await act(async () => {
    sdk.changed('SIGNED_OUT', null);
    sdk.changed('SIGNED_IN', { user: { id: 'bob' } });
    await vi.runAllTimersAsync();
  });
  expect(bob.isLive()).toBe(false);
  expect(current.scope!.id).not.toBe(bob.id);
});
it('retains the environment for token refresh and does not restore old subject storage', async () => {
  sessionStorage.setItem('kami-financial-subject', 'other');
  sessionStorage.setItem(privateStorageKey, '{}');
  await render();
  expect(sessionStorage.getItem(privateStorageKey)).toBeNull();
  const original = current.scope;
  await act(async () => {
    sdk.changed('TOKEN_REFRESHED', { user: { id: 'alice' } });
    await vi.runAllTimersAsync();
  });
  expect(current.scope).toBe(original);
});

it('invalidates an expired session while a fresh provider check is unresolved, then purges rejected private state', async () => {
  sdk.expires = Math.floor(Date.now() / 1000) + 1;
  await render();
  const original = current.scope!;
  sessionStorage.setItem(privateStorageKey, '{}');
  let finish!: (value: unknown) => void;
  sdk.checked.mockImplementation(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(current.loading).toBe(true);
  await act(async () =>
    finish({
      data: { user: null },
      error: { name: 'AuthApiError', status: 401 },
    }),
  );
  expect(current.scope).toBeUndefined();
  expect(original.isLive()).toBe(false);
  expect(sessionStorage.getItem(privateStorageKey)).toBeNull();
  expect(current.error).toContain('Account verification failed');
});
it('ignores a late verified response after cross-tab logout', async () => {
  await render();
  const original = current.scope!;
  let finish!: (value: unknown) => void;
  sdk.checked.mockImplementation(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  await act(async () => window.dispatchEvent(new Event('popstate')));
  await act(async () => sdk.changed('SIGNED_OUT', null));
  await act(async () =>
    finish({ data: { user: { id: 'alice' } }, error: null }),
  );
  expect(current.scope).toBeUndefined();
  expect(original.isLive()).toBe(false);
});
