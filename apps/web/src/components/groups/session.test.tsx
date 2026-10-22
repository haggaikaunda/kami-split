// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { useRelayEnvironment } from 'react-relay';
import { fetchQuery, type IEnvironment } from 'relay-runtime';
import inventoryDocument, {
  type personalInventoryQuery,
} from '@/lib/relay/__generated__/personalInventoryQuery.graphql';
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
let renderedEnvironment: IEnvironment | undefined;
function EnvironmentProbe() {
  const environment = useRelayEnvironment();
  useEffect(() => {
    renderedEnvironment = environment;
  }, [environment]);
  return null;
}
function Probe() {
  const access = useFinancialSession();
  useEffect(() => {
    current = access;
  }, [access]);
  return (
    <p>
      {access.scope && <EnvironmentProbe />}
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
  vi.unstubAllGlobals();
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
  expect(renderedEnvironment).toBe(original.environment);
  sessionStorage.setItem(privateStorageKey, '{}');
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new DOMException('Blocked', 'SecurityError');
  });
  await act(async () => sdk.changed('SIGNED_OUT', null));
  expect(original.isLive()).toBe(false);
  expect(current.scope).toBeUndefined();
  expect(host.textContent).not.toContain('Private alice');
  expect(host.textContent).toContain('Private storage is unavailable');
  expect(current.discardAppearance).toBe(true);
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
  expect(renderedEnvironment).toBe(original.environment);
  sessionStorage.setItem(privateStorageKey, '{}');
  await act(async () => {
    sdk.changed('SIGNED_IN', { user: { id: 'bob' } });
    await vi.runAllTimersAsync();
  });
  expect(original.isLive()).toBe(false);
  expect(current.scope!.actor).toBe('bob');
  expect(renderedEnvironment).toBe(current.scope!.environment);
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
  expect(renderedEnvironment).toBe(original!.environment);
});

it('invalidates an expired session while a fresh provider check is unresolved, then purges rejected private state', async () => {
  sdk.expires = Math.floor(Date.now() / 1000) + 1;
  await render();
  const original = current.scope!;
  expect(renderedEnvironment).toBe(original.environment);
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
  await act(async () => {
    window.dispatchEvent(new Event('popstate'));
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => sdk.changed('SIGNED_OUT', null));
  await act(async () =>
    finish({ data: { user: { id: 'alice' } }, error: null }),
  );
  expect(current.scope).toBeUndefined();
  expect(original.isLive()).toBe(false);
});

it('coalesces overlapping foreground events but cancels queued verification on logout', async () => {
  await render();
  const original = current.scope;
  sdk.checked.mockClear();
  await act(async () => {
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('popstate'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(current.loading).toBe(true);
  expect(sdk.checked).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(sdk.checked).toHaveBeenCalledTimes(1);
  expect(current.scope).toBe(original);
  await act(async () => {
    window.dispatchEvent(new Event('pageshow'));
    sdk.changed('SIGNED_OUT', null);
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(sdk.checked).toHaveBeenCalledTimes(1);
  expect(current.scope).toBeUndefined();
  expect(original?.isLive()).toBe(false);
});

it('rejects an old verification resolved between foreground invalidation and its queued replacement', async () => {
  await render();
  const completions: ((value: unknown) => void)[] = [];
  sdk.checked.mockImplementation(
    () => new Promise((resolve) => completions.push(resolve)),
  );
  await act(async () => {
    window.dispatchEvent(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(completions).toHaveLength(1);
  await act(async () => {
    window.dispatchEvent(new Event('popstate'));
    completions[0]({ data: { user: { id: 'alice' } }, error: null });
  });
  expect(current.loading).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(completions).toHaveLength(2);
  await act(async () =>
    completions[1]({ data: { user: { id: 'alice' } }, error: null }),
  );
  expect(current.loading).toBe(false);
});

it.each([503, 401, 403])(
  'disposes private access on verification %s, discarding appearance only for confirmed denial',
  async (status) => {
    await render();
    const original = current.scope;
    sessionStorage.setItem(privateStorageKey, '{}');
    sdk.checked.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthApiError', status },
    });
    await act(async () => {
      window.dispatchEvent(new Event('pageshow'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(current.scope).toBeUndefined();
    expect(original?.isLive()).toBe(false);
    expect(sessionStorage.getItem(privateStorageKey)).toBeNull();
    expect(current.error).toContain('Account verification failed');
    expect(current.discardAppearance).toBe(status === 401 || status === 403);
  },
);

it('reports the verified presentation actor when a different account cannot open private storage', async () => {
  await render();
  const original = current.scope;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  await act(async () => {
    sdk.changed('SIGNED_IN', { user: { id: 'bob' } });
    await vi.runAllTimersAsync();
  });
  expect(current.scope).toBeUndefined();
  expect(original?.isLive()).toBe(false);
  expect(current.error).toContain('Private storage is unavailable');
  expect(current.appearanceActor).toBe('bob');
});

async function denyBankingInventory() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              bankingConnections: {
                __typename: 'BankingConnectionsResult',
                code: 'FORBIDDEN',
                connections: [],
                endCursor: null,
                hasNextPage: false,
              },
            },
          }),
          { status: 200 },
        ),
    ),
  );
  await act(async () => {
    await expect(
      fetchQuery<personalInventoryQuery>(
        current.scope!.environment,
        inventoryDocument,
        { first: 20 },
        { fetchPolicy: 'network-only' },
      ).toPromise(),
    ).rejects.toThrow('FORBIDDEN');
  });
}
it('purges enrollment recovery identifiers and private drafts after confirmed banking access loss', async () => {
  await render();
  const original = current.scope!;
  sessionStorage.setItem('kami-personal-enrollment:alice', 'opaque-attempt');
  sessionStorage.setItem(privateStorageKey, 'private-draft');
  sessionStorage.setItem('unrelated-setting', 'retained');
  original.environment.commitUpdate((store) =>
    store
      .create('private-sentinel', 'BankingAccount')
      .setValue('Private account', 'name'),
  );
  const remove = Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
    this: Storage,
    key,
  ) {
    expect(original.isLive()).toBe(false);
    return remove.call(this, key);
  });
  await denyBankingInventory();
  expect(original.isLive()).toBe(false);
  expect(
    original.environment.getStore().getSource().get('private-sentinel'),
  ).toBeUndefined();
  expect(current.scope).toBeUndefined();
  expect(current.discardAppearance).toBe(true);
  expect(sessionStorage.getItem('kami-personal-enrollment:alice')).toBeNull();
  expect(sessionStorage.getItem(privateStorageKey)).toBeNull();
  expect(sessionStorage.getItem('unrelated-setting')).toBe('retained');
  expect(host.textContent).not.toContain('Private alice');
});
it('keeps failed access-loss cleanup pending and retries it before admitting the same actor again', async () => {
  await render();
  const original = current.scope!;
  sessionStorage.setItem('kami-personal-enrollment:alice', 'opaque-attempt');
  sessionStorage.setItem(privateStorageKey, 'private-draft');
  const remove = Storage.prototype.removeItem;
  const blocked = vi
    .spyOn(Storage.prototype, 'removeItem')
    .mockImplementation(function (this: Storage, key) {
      expect(original.isLive()).toBe(false);
      if (key.startsWith('kami-personal-enrollment:'))
        throw new DOMException('Blocked', 'SecurityError');
      return remove.call(this, key);
    });
  await denyBankingInventory();
  expect(current.scope).toBeUndefined();
  expect(current.error).toContain('Financial access is unavailable');
  expect(sessionStorage.getItem(privateStorageKey)).toBeNull();
  expect(sessionStorage.getItem('kami-personal-enrollment:alice')).toBe(
    'opaque-attempt',
  );
  // A second failed admission must not forget the remaining cleanup intent.
  await act(async () => {
    sdk.changed('TOKEN_REFRESHED', { user: { id: 'alice' } });
    await vi.runAllTimersAsync();
  });
  expect(current.scope).toBeUndefined();
  expect(current.error).toContain('Private storage is unavailable');
  blocked.mockRestore();
  await act(async () => {
    sdk.changed('TOKEN_REFRESHED', { user: { id: 'alice' } });
    await vi.runAllTimersAsync();
  });
  expect(sessionStorage.getItem('kami-personal-enrollment:alice')).toBeNull();
  expect(current.scope?.actor).toBe('alice');
  expect(current.scope?.id).not.toBe(original.id);
  expect(original.isLive()).toBe(false);
});
