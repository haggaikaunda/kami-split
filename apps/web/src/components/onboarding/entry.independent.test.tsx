// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { OnboardingEntry } from './entry';
import { ScopedInvitations } from './scoped-invitations';
import type { FinancialScope } from '@/lib/relay/environment';
import {
  RequestEpoch,
  readAttempt,
  saveAttempt,
} from '@/lib/onboarding/client';
const sdk = vi.hoisted(() => ({
  session: {
    user: { id: 'alice', email: 'alice@example.test' },
    access_token: 'alice-token',
  } as object | null,
  changed: (_event: string, _session: object | null) => {
    void _event;
    void _session;
  },
  rejected: false,
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
  replace: vi.fn(),
  signOut: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: sdk.session } }),
      getUser: async () => ({
        error: sdk.rejected ? { name: 'AuthApiError', status: 401 } : null,
        data: { user: (sdk.session as { user: object } | null)?.user ?? null },
      }),
      onAuthStateChange: (changed: typeof sdk.changed) => {
        sdk.changed = changed;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      setSession: async () => ({ error: null }),
      updateUser: sdk.updateUser,
      verifyOtp: sdk.verifyOtp,
      signOut: sdk.signOut,
    },
  }),
}));
vi.mock('@supabase/ssr', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return { createBrowserClient: createClient };
});
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: 'a',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: sdk.replace, refresh: vi.fn() }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@/components/groups/session', () => ({
  useFinancialSession: () => ({
    scope: {
      actor: 'alice',
      isLive: () => true,
      environment: {
        commitUpdate: (update: (store: unknown) => void) =>
          update({ invalidateStore: sdk.invalidate }),
      },
    },
  }),
}));
let container: HTMLDivElement;
let root: Root;
let requests: {
  path: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}[];
let respond: (path: string, body: Record<string, unknown>) => Promise<unknown>;
const key = '12345678-1234-1234-1234-123456789012';
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, '', '/join');
  sdk.rejected = false;
  sdk.updateUser.mockReset();
  sdk.verifyOtp.mockReset();
  sdk.replace.mockReset();
  sdk.invalidate.mockReset();
  sdk.signOut.mockReset();
  sdk.signOut.mockImplementation(async () => {
    sdk.changed('SIGNED_OUT', null);
    return { error: null };
  });
  sessionStorage.clear();
  sessionStorage.setItem('kami-onboarding-link-digest', 'a'.repeat(64));
  sdk.session = {
    user: { id: 'alice', email: 'alice@example.test' },
    access_token: 'alice-token',
  };
  requests = [];
  respond = async (path) =>
    path === '/api/onboarding-config'
      ? { url: 'https://example.test', key: 'public' }
      : { groupName: 'Private group', inviterDisplayName: 'Owner' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body ?? '{}'));
      requests.push({ path, body, signal: options?.signal as AbortSignal });
      const value = await respond(path, body);
      return { ok: true, json: async () => value };
    }),
  );
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    callback();
    return 1;
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = async (mode: Parameters<typeof OnboardingEntry>[0]['mode']) => {
  await act(async () => root.render(<OnboardingEntry mode={mode} />));
};
const scoped = async (id = 'group-a', name = 'House') => {
  const scope = {
    id: 'scope-alice',
    actor: 'alice',
    isLive: () => true,
  } as unknown as FinancialScope;
  await act(async () =>
    root.render(
      <ScopedInvitations scope={scope} group={{ id, name }} members={[]} />,
    ),
  );
};
const button = (name: string) =>
  [...container.querySelectorAll('button')].find(
    (item) => item.textContent === name,
  )!;
const click = async (name: string) => {
  await act(async () => button(name).click());
};
it('aborts requests and rejects late results when transport ignores abort', async () => {
  const epoch = new RequestEpoch();
  let resolve!: (value: string) => void;
  let signal!: AbortSignal;
  const pending = epoch.run((value) => {
    signal = value;
    return new Promise<string>((done) => {
      resolve = done;
    });
  });
  const rejected = expect(pending).rejects.toThrow('SESSION_CHANGED');
  epoch.reset();
  expect(signal.aborted).toBe(true);
  resolve('private');
  await rejected;
  await expect(epoch.run(async () => 'fresh')).resolves.toBe('fresh');
});
it('retains original operation context across storage reloads', () => {
  const attempt = {
    kind: 'RESEND' as const,
    key,
    groupID: 'original-group',
    invitationID: 'original-invitation',
  };
  saveAttempt(attempt);
  expect(readAttempt()).toEqual(attempt);
  saveAttempt(null);
  expect(readAttempt()).toBeNull();
});
it('deduplicates clicks and preserves interrupted acceptance through uncertain recovery', async () => {
  await render('join');
  expect(container.textContent).toContain(
    'share the group’s ledger and full expense history',
  );
  expect(container.textContent).toContain('all active Household members');
  expect(container.textContent).toContain(
    'No additional sharing confirmation is needed',
  );
  let reject!: (error: Error) => void;
  respond = async () =>
    new Promise((_resolve, fail) => {
      reject = fail;
    });
  await act(async () => {
    button('Join Private group').click();
    button('Join Private group').click();
  });
  expect(requests.filter((item) => item.path.endsWith('/accept'))).toHaveLength(
    1,
  );
  const original = readAttempt();
  expect(original?.kind).toBe('ACCEPT');
  await act(async () => reject(new Error('UNAVAILABLE')));
  expect(button('Join Private group').disabled).toBe(true);
  expect(readAttempt()).toEqual(original);
  respond = async (_path, body) => {
    expect(body.variables).toEqual({ kind: 'ACCEPT', key: original!.key });
    return { data: { invitationAction: { outcome: 'NOT_OBSERVED' } } };
  };
  await click('Check the original request');
  expect(readAttempt()).toEqual(original);
  respond = async () => ({
    data: {
      invitationAction: { outcome: 'HISTORICAL_ACCEPTANCE', hasAccess: false },
    },
  });
  await click('Check the original request');
  expect(readAttempt()).toBeNull();
  expect(container.textContent).toContain('you no longer have access');
});
it('discards late acceptance after account switch and clears private context', async () => {
  await render('join');
  let resolve!: (value: unknown) => void;
  respond = async (path) =>
    path.endsWith('/accept')
      ? new Promise((done) => {
          resolve = done;
        })
      : {};
  await click('Join Private group');
  await act(async () =>
    sdk.changed('SIGNED_IN', {
      user: { id: 'bob', email: 'bob@example.test' },
      access_token: 'bob-token',
    }),
  );
  expect(readAttempt()).toBeNull();
  expect(container.textContent).not.toContain('Private group');
  await act(async () =>
    resolve({ code: 'APPLIED', hasAccess: true, groupID: 'secret' }),
  );
  expect(container.textContent).not.toContain('You have joined');
});
it('aborts acceptance on unmount and preserves original recovery', async () => {
  await render('join');
  let resolve!: (value: unknown) => void;
  respond = async () =>
    new Promise((done) => {
      resolve = done;
    });
  await click('Join Private group');
  const original = readAttempt();
  const request = requests.find((item) => item.path.endsWith('/accept'))!;
  await act(async () => root.render(<p>Elsewhere</p>));
  expect(request.signal!.aborted).toBe(true);
  await act(async () => resolve({ code: 'APPLIED', hasAccess: true }));
  expect(readAttempt()).toEqual(original);
});
it('explains session expiration and prevents a second acceptance', async () => {
  await render('join');
  respond = async () => {
    throw new Error('UNAUTHENTICATED');
  };
  await click('Join Private group');
  expect(container.textContent).toContain('Your session has expired');
  expect(readAttempt()?.kind).toBe('ACCEPT');
  expect(button('Join Private group').disabled).toBe(true);
});
it('does not show old account password success after an account switch', async () => {
  let resolve!: (value: unknown) => void;
  sdk.updateUser.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render('password');
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await act(async () =>
    sdk.changed('SIGNED_IN', {
      user: { id: 'bob', email: 'bob@example.test' },
      access_token: 'bob-token',
    }),
  );
  await act(async () => resolve({ error: null }));
  expect(container.textContent).not.toContain('Password saved');
});
it('recovers an uncertain resend with its original key after remount without sending another email', async () => {
  respond = async (_path, body) => {
    const query = String(body.query);
    if (query.includes('viewer'))
      return {
        data: {
          viewer: {
            __typename: 'Viewer',
            groups: [{ id: 'group-a', name: 'House' }],
          },
        },
      };
    if (query.includes('ownerInvitations'))
      return {
        data: {
          ownerInvitations: {
            items: [
              {
                id: 'invite-a',
                recipient: 'friend@example.test',
                expiresAt: '2026-10-01T00:00:00Z',
                lifecycle: 'PENDING',
                delivery: 'UNKNOWN',
                actionID: 'old-send',
              },
            ],
            nextCursor: null,
          },
        },
      };
    if (query.includes('resendInvitation')) throw new Error('UNAVAILABLE');
    throw new Error('Unexpected request');
  };
  await scoped();
  await click('Resend and renew for seven days');
  const original = readAttempt();
  expect(original).toMatchObject({
    kind: 'RESEND',
    groupID: 'group-a',
    invitationID: 'invite-a',
  });
  expect(button('Resend and renew for seven days').disabled).toBe(true);
  await act(async () => root.render(<p>Elsewhere</p>));
  await scoped();
  respond = async (_path, body) => {
    expect(body.variables).toEqual({ kind: 'RESEND', key: original!.key });
    return {
      data: {
        invitationAction: {
          outcome: 'APPLIED',
          delivery: 'UNKNOWN',
          committedExpiresAt: '2026-10-07T00:00:00Z',
          currentExpiresAt: '2026-10-08T00:00:00Z',
        },
      },
    };
  };
  await click('Check the original request');
  expect(readAttempt()).toBeNull();
  expect(container.textContent).toContain('Expiry saved by this action');
  expect(container.textContent).toContain('Current expiry');
  expect(
    requests.filter((item) =>
      String(item.body.query).includes('resendInvitation'),
    ),
  ).toHaveLength(1);
  expect(
    requests.filter((item) =>
      String(item.body.query).includes('retryInvitationDelivery'),
    ),
  ).toHaveLength(0);
});
it('verifies the email, sets a password and returns to explicit invitation admission', async () => {
  const verifiedSession = sdk.session;
  sdk.session = null;
  const tokenHash = 'a'.repeat(64);
  window.history.replaceState(
    null,
    '',
    `/auth/confirm#token_hash=${tokenHash}&type=invite&state=callback-state`,
  );
  sdk.verifyOtp.mockResolvedValue({
    data: { session: verifiedSession },
    error: null,
  });
  const defaultRespond = respond;
  respond = async (path, body) =>
    path === '/api/onboarding/callback-state'
      ? { code: 'READY' }
      : defaultRespond(path, body);
  await render('confirm');
  expect(window.location.hash).toBe('');
  await click('Continue with email link');
  expect(
    requests.find((item) => item.path.endsWith('/callback-state'))?.body,
  ).toEqual({ state: 'callback-state' });
  expect(sdk.verifyOtp).toHaveBeenCalledWith({
    token_hash: tokenHash,
    type: 'invite',
  });
  expect(sdk.replace).toHaveBeenCalledWith('/sign-in?flow=password');
  expect(requests.some((item) => item.path.endsWith('/accept'))).toBe(false);

  sdk.session = verifiedSession;
  sdk.updateUser.mockResolvedValue({ error: null });
  await act(async () =>
    root.render(<OnboardingEntry key="password" mode="password" />),
  );
  await act(async () => {
    const inputs = container.querySelectorAll('input[type=password]');
    for (const input of inputs) {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'SyntheticPassword162!');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(sdk.updateUser).toHaveBeenCalledOnce();
  expect(sdk.updateUser).toHaveBeenCalledWith({
    password: 'SyntheticPassword162!',
  });
  expect(container.textContent).toContain('Your account is ready');
  expect(sessionStorage.getItem('kami-onboarding-link-digest')).toBe(
    'a'.repeat(64),
  );
  expect(requests.some((item) => item.path.endsWith('/accept'))).toBe(false);

  window.history.replaceState(null, '', '/join');
  await act(async () =>
    root.render(<OnboardingEntry key="join" mode="join" />),
  );
  expect(container.textContent).toContain('Private group');
  respond = async (path, body) => {
    if (path === '/api/onboarding/accept') {
      expect(body.tokenDigest).toBe('a'.repeat(64));
      return { code: 'ADMITTED', groupID: 'intended-group', hasAccess: true };
    }
    return defaultRespond(path, body);
  };
  await click('Join Private group');
  expect(requests.filter((item) => item.path.endsWith('/accept'))).toHaveLength(
    1,
  );
  expect(container.textContent).toContain('You have joined the group');
});
it('rejects malformed callback fragments and removes credentials from the address', async () => {
  sdk.session = null;
  window.history.replaceState(
    null,
    '',
    '/auth/confirm#token_hash=invalid&type=invite&state=state',
  );
  await render('confirm');
  expect(window.location.hash).toBe('');
  expect(container.textContent).toContain('invalid, expired');
  expect(button('Continue with email link')).toBeUndefined();
});
it('resubmits an unobserved acceptance with the original key after an offline failure', async () => {
  window.history.replaceState(null, '', '/join');
  await render('join');
  respond = async () => {
    throw new TypeError('Failed to fetch');
  };
  await click('Join Private group');
  const original = readAttempt()!;
  respond = async () => ({
    data: { invitationAction: { outcome: 'NOT_OBSERVED' } },
  });
  await click('Check the original request');
  expect(readAttempt()).toEqual(original);
  respond = async (path, body) => {
    expect(path).toBe('/api/onboarding/accept');
    expect(body).toEqual({
      key: original.key,
      tokenDigest: original.tokenDigest,
    });
    return { code: 'APPLIED', groupID: 'group-a', hasAccess: true };
  };
  await click('Try the original request again');
  expect(readAttempt()).toBeNull();
  expect(container.textContent).toContain('You have joined the group');
  expect(
    requests
      .filter((item) => item.path.endsWith('/accept'))
      .map((item) => item.body.key),
  ).toEqual([original.key, original.key]);
});
it('resubmits an unobserved resend after navigation using the retained group, invitation, and key', async () => {
  const original = {
    kind: 'RESEND' as const,
    key,
    groupID: 'original-group',
    invitationID: 'original-invitation',
  };
  saveAttempt(original);
  respond = async () => ({
    data: { ownerInvitations: { items: [], nextCursor: null } },
  });
  await scoped('original-group', 'Original');
  respond = async () => {
    throw new TypeError('Failed to fetch');
  };
  await click('Try the original request again');
  expect(readAttempt()).toEqual(original);
  respond = async () => ({
    data: { invitationAction: { outcome: 'NOT_OBSERVED' } },
  });
  await click('Check the original request');
  respond = async (_path, body) => {
    if (String(body.query).includes('resendInvitation')) {
      expect(body.variables).toEqual({
        groupID: original.groupID,
        id: original.invitationID,
        email: '',
        key,
      });
      return {
        data: {
          resendInvitation: { outcome: 'APPLIED', delivery: 'ACCEPTED' },
        },
      };
    }
    expect(body.variables).toEqual({ groupID: original.groupID, after: null });
    return { data: { ownerInvitations: { items: [], nextCursor: null } } };
  };
  await click('Try the original request again');
  expect(readAttempt()).toBeNull();
  expect(
    requests.filter((item) =>
      String(item.body.query).includes('resendInvitation'),
    ),
  ).toHaveLength(2);
});
it('releases a definitely invalid create operation so the email can be corrected', async () => {
  respond = async (_path, body) =>
    String(body.query).includes('viewer')
      ? {
          data: {
            viewer: {
              __typename: 'Viewer',
              groups: [{ id: 'group-a', name: 'House' }],
            },
          },
        }
      : String(body.query).includes('createTargetedInvitation')
        ? { data: { createTargetedInvitation: { code: 'INVALID_EMAIL' } } }
        : { data: { ownerInvitations: { items: [], nextCursor: null } } };
  await scoped();
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(
    requests.filter((item) =>
      String(item.body.query).includes('createTargetedInvitation'),
    ),
  ).toHaveLength(1);
  expect(readAttempt()).toBeNull();
  expect(button('Create invitation').disabled).toBe(false);
  expect(
    (container.querySelector('#invite-email') as HTMLInputElement).disabled,
  ).toBe(false);
});
it('blocks retry when the current invitation differs from the retained acceptance', async () => {
  saveAttempt({ kind: 'ACCEPT', key, tokenDigest: 'original-digest' });
  sessionStorage.setItem('kami-onboarding-link-digest', 'different-digest');
  await render('join');
  await click('Try the original request again');
  expect(requests.filter((item) => item.path.endsWith('/accept'))).toHaveLength(
    0,
  );
  expect(readAttempt()?.key).toBe(key);
});
it('binds initial and retried acceptance to the original tab invitation when the shared cookie changes', async () => {
  const originalDigest = 'a'.repeat(64);
  sessionStorage.setItem('kami-onboarding-link-digest', originalDigest);
  window.history.replaceState(null, '', '/join');
  await render('join');
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  const attempts: Record<string, unknown>[] = [];
  vi.mocked(fetch).mockImplementation(async (path, options) => {
    if (path === '/api/onboarding/accept') {
      attempts.push(JSON.parse(String(options?.body)));
      // Another tab replaced the shared cookie with invitation B. The server
      // rejects this tab's invitation A binding instead of admitting B.
      return {
        ok: false,
        json: async () => ({ code: 'ORIGINAL_LINK_REQUIRED' }),
      } as Response;
    }
    return originalFetch(path, options);
  });
  await click('Join Private group');
  const original = readAttempt()!;
  expect(original.tokenDigest).toBe(originalDigest);
  expect(attempts).toEqual([
    { key: original.key, tokenDigest: originalDigest },
  ]);
  expect(container.textContent).not.toContain('You have joined the group');
  await click('Try the original request again');
  expect(attempts).toEqual([
    { key: original.key, tokenDigest: originalDigest },
    { key: original.key, tokenDigest: originalDigest },
  ]);
  expect(readAttempt()).toEqual(original);
  expect(container.textContent).not.toContain('You have joined the group');
});
it('asks a fresh tab to reopen the original invitation without creating an unrecoverable attempt', async () => {
  sessionStorage.removeItem('kami-onboarding-link-digest');
  window.history.replaceState(null, '', '/join');
  await render('join');
  await click('Join Private group');
  expect(container.textContent).toContain(
    'Reopen the original application invitation link in this tab',
  );
  expect(readAttempt()).toBeNull();
  expect(requests.filter((item) => item.path.endsWith('/accept'))).toHaveLength(
    0,
  );
});
it('removes local invitation state on passive signout without clearing another tab context', async () => {
  saveAttempt({ kind: 'ACCEPT', key, tokenDigest: 'a'.repeat(64) });
  await render('join');
  await act(async () => sdk.changed('SIGNED_OUT', null));
  expect(sessionStorage.getItem('kami-onboarding-link-digest')).toBeNull();
  expect(readAttempt()).toBeNull();
  expect(container.textContent).not.toContain('Private group');
  expect(requests.some((r) => r.path.endsWith('/clear'))).toBe(false);
});

it('copies shared links without renewing or sending and deliberately renews with recovery', async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  const invite = {
    id: 'invite',
    kind: 'SHARED',
    recipient: null,
    expiresAt: '2026-01-01T00:00:00Z',
    lifecycle: 'EXPIRED',
    actionID: null,
    delivery: 'NOT_REQUESTED',
  };
  respond = async (path, body) => {
    if (path === '/api/onboarding-config')
      return { url: 'https://example.test', key: 'public' };
    if (path === '/api/onboarding/copy-shared')
      return { link: 'https://example.test/join#sensitive' };
    const query = String(body.query);
    if (query.includes('ownerInvitations'))
      return {
        data: { ownerInvitations: { items: [invite], nextCursor: null } },
      };
    if (query.includes('renewSharedInvitation'))
      return {
        data: {
          renewSharedInvitation: {
            outcome: 'APPLIED',
            delivery: 'NOT_REQUESTED',
          },
        },
      };
    return {
      data: {
        viewer: {
          __typename: 'Viewer',
          groups: [{ id: 'group', name: 'Group' }],
        },
      },
    };
  };
  await scoped('group', 'Group');
  const before = requests.length;
  await click('Copy shared link');
  expect(writeText).toHaveBeenCalledWith('https://example.test/join#sensitive');
  expect(requests.slice(before)).toHaveLength(1);
  expect(requests.at(-1)?.path).toBe('/api/onboarding/copy-shared');
  expect(container.textContent).not.toContain('sensitive');
  expect(sessionStorage.getItem('kami-onboarding-attempt')).toBeNull();
  expect(button('Resend and renew for seven days')).toBeUndefined();
  await click('Renew shared link for seven days');
  expect(
    requests.some(({ body }) =>
      String(body.query).includes('renewSharedInvitation'),
    ),
  ).toBe(true);
  expect(
    requests.some(({ body }) =>
      String(body.query).includes('retryInvitationDelivery'),
    ),
  ).toBe(false);
  expect(container.textContent).toContain('No invitation email was sent.');
});

it('keeps targeted preview anonymous and requires explicit proof before password setup', async () => {
  sdk.session = null;
  const prior = respond;
  respond = async (path, body) =>
    path.endsWith('/preview')
      ? {
          kind: 'TARGETED',
          groupName: 'Household',
          inviterDisplayName: 'Owner',
        }
      : path.endsWith('/targeted-continuation')
        ? {
            code: 'READY',
            tokenHash: 'b'.repeat(64),
            type: 'signup',
            needsPassword: true,
          }
        : prior(path, body);
  sdk.verifyOtp.mockResolvedValue({
    data: {
      session: {
        user: { id: 'target', email: 'target@example.test' },
        access_token: 'token',
      },
    },
    error: null,
  });
  await render('join');
  expect(container.querySelector('input[type=email]')).toBeNull();
  expect(requests.some((r) => r.path.endsWith('/targeted-continuation'))).toBe(
    false,
  );
  expect(container.textContent).not.toContain('target@example.test');
  await click('Continue with invitation');
  expect(sdk.verifyOtp).toHaveBeenCalledWith({
    token_hash: 'b'.repeat(64),
    type: 'signup',
  });
  expect(container.textContent).toContain('Create your Kami Grow account');
  expect(container.querySelectorAll('input[type=password]')).toHaveLength(2);
  expect(
    requests.some(
      (r) => r.path.endsWith('/provision') || r.path.endsWith('/accept'),
    ),
  ).toBe(false);
});
it('continues existing targeted identity without password then explicitly admits and links to the group', async () => {
  sdk.session = null;
  const prior = respond;
  respond = async (path, body) =>
    path.endsWith('/preview')
      ? {
          kind: 'TARGETED',
          groupName: 'Household',
          inviterDisplayName: 'Owner',
        }
      : path.endsWith('/targeted-continuation')
        ? {
            code: 'READY',
            tokenHash: 'b'.repeat(64),
            type: 'magiclink',
            needsPassword: false,
          }
        : path.endsWith('/accept')
          ? { code: 'ADMITTED', groupID: 'group-a', hasAccess: true }
          : prior(path, body);
  sdk.verifyOtp.mockResolvedValue({
    data: {
      session: {
        user: { id: 'target', email: 'target@example.test' },
        access_token: 'token',
      },
    },
    error: null,
  });
  await render('join');
  await click('Continue with invitation');
  expect(container.textContent).toContain('Ready to join Household');
  expect(container.querySelector('input[type=password]')).toBeNull();
  expect(requests.some((r) => r.path.endsWith('/accept'))).toBe(false);
  await click('Join Household');
  expect(
    container.querySelector('a[href="/groups?group=group-a"]')?.textContent,
  ).toBe('Open Household');
});
it('offers shared first-time verification with generic check-email and no admission', async () => {
  sdk.session = null;
  const prior = respond;
  respond = async (path, body) =>
    path.endsWith('/preview')
      ? { kind: 'SHARED', groupName: 'Household', inviterDisplayName: 'Owner' }
      : prior(path, body);
  await render('join');
  await click('Create an account');
  expect(container.querySelector('input[type=email]')).not.toBeNull();
  expect(container.querySelector('input[type=password]')).toBeNull();
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(container.textContent).toContain('Check your email');
  expect(requests.filter((r) => r.path.endsWith('/provision'))).toHaveLength(1);
  expect(
    requests.some(
      (r) =>
        r.path.endsWith('/accept') || r.path.endsWith('/targeted-continuation'),
    ),
  ).toBe(false);
  await click('Use a different email');
  expect(container.querySelector('input[type=email]')).not.toBeNull();
});
it('keeps Account personal with shared active navigation and no group discovery request', async () => {
  window.history.replaceState(null, '', '/account');
  respond = async (path) =>
    path === '/api/onboarding-config'
      ? { url: 'https://example.test', key: 'public' }
      : {
          data: {
            currentProfile: {
              __typename: 'Profile',
              id: 'user-a',
              displayName: 'Alice 李',
            },
          },
        };
  await render('account');
  expect(container.querySelector('#display-name')).not.toBeNull();
  expect(
    (container.querySelector('#account-email') as HTMLInputElement).readOnly,
  ).toBe(true);
  expect(
    container.querySelector('a[href="/account"]')?.getAttribute('aria-current'),
  ).toBe('page');
  for (const href of ['/household', '/groups', '/trips', '/account'])
    expect(container.querySelector(`nav a[href="${href}"]`)).not.toBeNull();
  expect(button('Refresh groups')).toBeUndefined();
  expect(container.textContent).not.toContain('Manage invitations');
  expect(requests.some((r) => String(r.body.query).includes('viewer'))).toBe(
    false,
  );
});

it('switches a wrong targeted account without losing the invitation or accepting it', async () => {
  const prior = respond;
  respond = async (path, body) => {
    if (path.endsWith('/preview'))
      return {
        kind: 'TARGETED',
        groupName: 'Household',
        inviterDisplayName: 'Owner',
      };
    if (path.endsWith('/targeted-continuation'))
      throw new Error('WRONG_ACCOUNT');
    return prior(path, body);
  };
  await render('join');
  await click('Continue with invitation');
  expect(container.textContent).toContain(
    'This invitation is for another account',
  );
  await click('Switch account');
  expect(sdk.replace).not.toHaveBeenCalledWith('/sign-in');
  expect(container.textContent).toContain('Owner invited you to Household');
  expect(sessionStorage.getItem('kami-onboarding-link-digest')).toBe(
    'a'.repeat(64),
  );
  expect(
    requests.some(
      (r) => r.path.endsWith('/clear') || r.path.endsWith('/accept'),
    ),
  ).toBe(false);
});
it('discards targeted proof when another account signs in during provider verification', async () => {
  sdk.session = null;
  const prior = respond;
  respond = async (path, body) =>
    path.endsWith('/preview')
      ? {
          kind: 'TARGETED',
          groupName: 'Household',
          inviterDisplayName: 'Owner',
        }
      : path.endsWith('/targeted-continuation')
        ? {
            code: 'READY',
            tokenHash: 'b'.repeat(64),
            type: 'magiclink',
            needsPassword: false,
          }
        : prior(path, body);
  let finish!: (value: unknown) => void;
  sdk.verifyOtp.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render('join');
  await click('Continue with invitation');
  await act(async () =>
    sdk.changed('SIGNED_IN', {
      user: { id: 'other', email: 'other@example.test' },
      access_token: 'other',
    }),
  );
  await act(async () =>
    finish({
      data: {
        session: {
          user: { id: 'target', email: 'target@example.test' },
          access_token: 'token',
        },
      },
      error: null,
    }),
  );
  expect(container.textContent).not.toContain('target@example.test');
  expect(requests.some((r) => r.path.endsWith('/accept'))).toBe(false);
});
it('restores invitation context in a fresh callback tab before password setup', async () => {
  const verified = sdk.session;
  sdk.session = null;
  sessionStorage.removeItem('kami-onboarding-link-digest');
  window.history.replaceState(
    null,
    '',
    `/auth/confirm#token_hash=${'b'.repeat(64)}&type=invite&state=bound-state`,
  );
  const prior = respond;
  respond = async (path, body) =>
    path.endsWith('/callback-state')
      ? {
          tokenDigest: 'c'.repeat(64),
          kind: 'SHARED',
          groupName: 'Household',
          inviterDisplayName: 'Owner',
        }
      : prior(path, body);
  sdk.verifyOtp.mockResolvedValue({ data: { session: verified }, error: null });
  await render('confirm');
  await click('Continue with email link');
  expect(sessionStorage.getItem('kami-onboarding-link-digest')).toBe(
    'c'.repeat(64),
  );
  expect(sdk.replace).toHaveBeenCalledWith('/sign-in?flow=password');
  expect(requests.some((r) => r.path.endsWith('/accept'))).toBe(false);
});
it('rejects mismatched passwords and clears confirmation when the identity changes', async () => {
  await render('password');
  const fill = async (selector: string, value: string) => {
    await act(async () => {
      const input = container.querySelector(selector)!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  await fill('#new-password', 'SyntheticPassword164!');
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(container.textContent).toContain('The passwords must match.');
  expect(sdk.updateUser).not.toHaveBeenCalled();
  const confirmation = container.querySelectorAll(
    'input[type=password]',
  )[1] as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(confirmation, 'SyntheticPassword164!');
    confirmation.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    sdk.changed('SIGNED_IN', {
      user: { id: 'bob', email: 'bob@example.test' },
      access_token: 'bob',
    }),
  );
  expect(
    [...container.querySelectorAll('input[type=password]')].every(
      (input) => (input as HTMLInputElement).value === '',
    ),
  ).toBe(true);
});

it('scrubs a new same-route invitation and discards the previous success', async () => {
  await render('join');
  respond = async () => ({
    code: 'ADMITTED',
    groupID: 'old-group',
    hasAccess: true,
  });
  await click('Join Private group');
  expect(container.textContent).toContain('You joined Private group');
  respond = async (path) =>
    path.endsWith('/preview')
      ? {
          kind: 'SHARED',
          groupName: 'New household',
          inviterDisplayName: 'New owner',
        }
      : {};
  await act(async () => {
    window.history.replaceState(null, '', '/join#new-invitation-capability');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(window.location.hash).toBe('');
  expect(container.textContent).not.toContain('You joined Private group');
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain('Ready to join New household');
  });
  expect(requests.findLast((r) => r.path.endsWith('/start'))?.body).toEqual({
    token: 'new-invitation-capability',
  });
});
it('blocks a different hash invitation while the original acceptance is unresolved', async () => {
  await render('join');
  respond = async () => {
    throw new Error('UNAVAILABLE');
  };
  await click('Join Private group');
  const original = readAttempt();
  const startsBefore = requests.filter((r) => r.path.endsWith('/start')).length;
  await act(async () => {
    window.history.replaceState(
      null,
      '',
      '/join#different-invitation-capability',
    );
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(window.location.hash).toBe('');
  expect(container.textContent).not.toContain('Private group');
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain(
      'Reopen the original application invitation link',
    );
  });
  expect(readAttempt()).toEqual(original);
  expect(requests.filter((r) => r.path.endsWith('/start'))).toHaveLength(
    startsBefore,
  );
  expect(container.textContent).not.toContain('Private group');
});
it('replaces a same-route callback without verifying it on hash navigation', async () => {
  sdk.session = null;
  window.history.replaceState(
    null,
    '',
    `/auth/confirm#token_hash=${'a'.repeat(64)}&type=invite&state=old-state`,
  );
  await render('confirm');
  await act(async () => {
    window.history.replaceState(
      null,
      '',
      `/auth/confirm#token_hash=${'b'.repeat(64)}&type=invite&state=new-state`,
    );
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(window.location.hash).toBe('');
  expect(sdk.verifyOtp).not.toHaveBeenCalled();
  sdk.verifyOtp.mockResolvedValue({
    data: {
      session: {
        user: { id: 'new', email: 'new@example.test' },
        access_token: 'token',
      },
    },
    error: null,
  });
  await click('Continue with email link');
  expect(sdk.verifyOtp).toHaveBeenCalledWith({
    token_hash: 'b'.repeat(64),
    type: 'invite',
  });
  expect(
    requests.find((r) => r.path.endsWith('/callback-state'))?.body,
  ).toEqual({ state: 'new-state' });
});

it('explicit ordinary signout clears the shared server context and local state', async () => {
  const prior = respond;
  respond = async (path, body) =>
    path === '/api/graphql'
      ? {
          data: {
            currentProfile: {
              __typename: 'Profile',
              id: 'user-a',
              displayName: 'Alice',
            },
          },
        }
      : prior(path, body);
  await render('account');
  await click('Sign out of this session');
  expect(requests.filter((r) => r.path.endsWith('/clear'))).toHaveLength(1);
  expect(sessionStorage.getItem('kami-onboarding-link-digest')).toBeNull();
  expect(container.textContent).not.toContain('alice@example.test');
  expect(sdk.replace).toHaveBeenCalledWith('/sign-in');
});

it.each(['TARGETED', 'SHARED'])(
  'presents one accessible %s invitation identity without disclosing extra preview fields',
  async (kind) => {
    sdk.session = null;
    const prior = respond;
    respond = async (path, body) =>
      path.endsWith('/preview')
        ? {
            kind,
            groupName: 'Our very long household name & friends',
            inviterDisplayName: 'Alex & Sam',
            email: 'private@example.test',
            memberCount: 42,
          }
        : prior(path, body);
    await render('join');
    const identity = container.querySelector(
      'section[aria-labelledby="invitation-group-name"]',
    )!;
    expect(identity.querySelector('h2')?.textContent).toBe(
      'Our very long household name & friends',
    );
    expect(identity.textContent).toContain('Alex & Sam');
    expect(container.querySelectorAll('#invitation-group-name')).toHaveLength(
      1,
    );
    expect(container.textContent).not.toContain('private@example.test');
    expect(identity.textContent).not.toContain('42');
    expect(
      container.querySelectorAll('[data-ui~="onboarding-art"]'),
    ).toHaveLength(1);
    expect(document.activeElement).toBe(container.querySelector('h1'));
    if (kind === 'SHARED') {
      await click('Create an account');
      expect(document.activeElement).toBe(container.querySelector('h1'));
      expect(container.querySelectorAll('#invitation-group-name')).toHaveLength(
        1,
      );
      await act(async () => {
        const input = container.querySelector('input[type=email]')!;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(input, 'synthetic@example.test');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await click('Continue');
      expect(container.textContent).toContain('Check your email');
      expect(document.activeElement).toBe(container.querySelector('h1'));
    }
    expect(requests.some((r) => r.path.endsWith('/accept'))).toBe(false);
  },
);

it('allows password-session logout when no live invitation context remains', async () => {
  const request = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const response = await request(input, init);
    return String(input).endsWith('/clear')
      ? ({ ok: false, status: 409, json: response.json } as Response)
      : response;
  });
  const prior = respond;
  respond = async (path, body) =>
    path.endsWith('/clear')
      ? { code: 'CONTEXT_EXPIRED' }
      : path === '/api/graphql'
        ? {
            data: {
              currentProfile: {
                __typename: 'Profile',
                id: 'user-a',
                displayName: 'Alice',
              },
            },
          }
        : prior(path, body);
  await render('account');
  await click('Sign out of this session');
  expect(requests.filter((r) => r.path.endsWith('/clear'))).toHaveLength(1);
  expect(sessionStorage.getItem('kami-onboarding-link-digest')).toBeNull();
  expect(container.textContent).not.toContain('alice@example.test');
  expect(sdk.replace).toHaveBeenCalledWith('/sign-in');
});

it('retains the account if invitation-context clearing fails unexpectedly', async () => {
  const request = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const response = await request(input, init);
    return String(input).endsWith('/clear')
      ? ({ ok: false, status: 503, json: response.json } as Response)
      : response;
  });
  const prior = respond;
  respond = async (path, body) =>
    path.endsWith('/clear')
      ? { code: 'UNAVAILABLE' }
      : path === '/api/graphql'
        ? {
            data: {
              currentProfile: {
                __typename: 'Profile',
                id: 'user-a',
                displayName: 'Alice',
              },
            },
          }
        : prior(path, body);
  await render('account');
  await click('Sign out of this session');
  expect(container.textContent).toContain('alice@example.test');
  expect(sdk.replace).not.toHaveBeenCalled();
});

const profileResult = (displayName: string) => ({
  data: {
    currentProfile: { __typename: 'Profile', id: 'user-a', displayName },
  },
});
const fillName = async (value: string) => {
  await act(async () => {
    const input = container.querySelector('#display-name')!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const submitProfile = async () => {
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
};
const profileResponder = (displayName = 'Alice') => {
  respond = async (path) =>
    path === '/api/onboarding-config'
      ? { url: 'https://example.test', key: 'public' }
      : profileResult(displayName);
};
it('retains primary navigation when profile loading fails and supports retry', async () => {
  window.history.replaceState(null, '', '/account');
  const initial = respond;
  respond = async (path, body) => {
    if (path === '/api/graphql') throw new Error('UNAVAILABLE');
    return initial(path, body);
  };
  await render('account');
  expect(container.textContent).toContain('Your profile could not be loaded');
  expect(container.querySelectorAll('nav a')).toHaveLength(4);
  expect(button('Sign out of this session')).not.toBeUndefined();
  profileResponder('李 María');
  await click('Retry profile');
  expect(
    (container.querySelector('#display-name') as HTMLInputElement).value,
  ).toBe('李 María');
});
it('discards dirty edits, trims international names, and waits for one confirmed save', async () => {
  profileResponder();
  await render('account');
  expect(button('Save changes').disabled).toBe(true);
  await fillName('Unsaved');
  await click('Discard edits');
  expect(
    (container.querySelector('#display-name') as HTMLInputElement).value,
  ).toBe('Alice');
  await fillName('\u3000李 😀 María\u00a0');
  let finish!: (value: unknown) => void;
  respond = async (_path, body) => {
    expect(body.variables).toEqual({
      displayName: '李 😀 María',
      expectedDisplayName: 'Alice',
    });
    return new Promise((done) => {
      finish = done;
    });
  };
  await submitProfile();
  await submitProfile();
  expect(
    requests.filter((r) =>
      String(r.body.query).includes('mutation profileMutation'),
    ),
  ).toHaveLength(1);
  expect(container.textContent).not.toContain('Changes saved.');
  expect(container.querySelectorAll('nav a')).toHaveLength(4);
  await act(async () =>
    finish({
      data: {
        updateMyProfile: {
          __typename: 'Profile',
          id: 'user-a',
          displayName: '李 😀 María',
        },
      },
    }),
  );
  expect(container.textContent).toContain('Changes saved.');
  expect(
    (container.querySelector('#display-name') as HTMLInputElement).value,
  ).toBe('李 😀 María');
  expect(button('Save changes').disabled).toBe(true);
  expect(sdk.invalidate).toHaveBeenCalled();
});
it.each(['\u3000\t\u00a0', '😀'.repeat(121)])(
  'rejects invalid input while preserving the draft',
  async (value) => {
    profileResponder();
    await render('account');
    await fillName(value);
    await submitProfile();
    expect(container.textContent).toContain(
      'Enter a display name of 1–120 characters.',
    );
    expect(
      (container.querySelector('#display-name') as HTMLInputElement).value,
    ).toBe(value);
    expect(
      requests.some((r) =>
        String(r.body.query).includes('mutation profileMutation'),
      ),
    ).toBe(false);
    expect(
      container
        .querySelector('#display-name')
        ?.getAttribute('aria-describedby'),
    ).toContain('display-name-error');
  },
);
it('preserves an uncertain save draft and requires authoritative reconciliation before explicit retry', async () => {
  profileResponder();
  await render('account');
  await fillName('My edit');
  respond = async () => {
    throw new TypeError('Failed to fetch');
  };
  await submitProfile();
  expect(button('Save changes').disabled).toBe(true);
  expect(
    (container.querySelector('#display-name') as HTMLInputElement).value,
  ).toBe('My edit');
  profileResponder('Saved elsewhere');
  await click('Check current profile');
  expect(
    (container.querySelector('#display-name') as HTMLInputElement).value,
  ).toBe('My edit');
  expect(container.textContent).toContain(
    'Current saved name: Saved elsewhere',
  );
  respond = async (_path, body) => {
    expect(body.variables).toEqual({
      displayName: 'My edit',
      expectedDisplayName: 'Saved elsewhere',
    });
    return {
      data: {
        updateMyProfile: {
          __typename: 'Profile',
          id: 'user-a',
          displayName: 'My edit',
        },
      },
    };
  };
  await submitProfile();
  expect(container.textContent).toContain('Changes saved.');
});
it('ignores a late profile save after account switch', async () => {
  profileResponder();
  await render('account');
  await fillName('Old actor secret');
  let finish!: (value: unknown) => void;
  respond = async (_path, body) =>
    String(body.query).includes('mutation profileMutation')
      ? new Promise((done) => {
          finish = done;
        })
      : profileResult('Bob');
  await submitProfile();
  await act(async () =>
    sdk.changed('SIGNED_IN', {
      user: { id: 'bob', email: 'bob@example.test' },
      access_token: 'bob-token',
    }),
  );
  await act(async () =>
    finish({
      data: {
        updateMyProfile: {
          __typename: 'Profile',
          id: 'user-a',
          displayName: 'Old actor secret',
        },
      },
    }),
  );
  expect(container.textContent).not.toContain('Old actor secret');
  expect(container.textContent).not.toContain('Changes saved.');
  expect(
    (container.querySelector('#display-name') as HTMLInputElement).value,
  ).toBe('Bob');
});
it('keeps unresolved invitation recovery in its original workspace when navigating to another', async () => {
  const original = {
    kind: 'RESEND' as const,
    key,
    groupID: 'group-a',
    invitationID: 'invite-a',
  };
  saveAttempt(original);
  respond = async () => ({
    data: { ownerInvitations: { items: [], nextCursor: null } },
  });
  await scoped('group-b', 'Maui');
  expect(
    container.querySelector('[aria-label="People and invitations for Maui"]'),
  ).not.toBeNull();
  expect(container.textContent).toContain('belongs to another workspace');
  expect(container.querySelector('a')?.getAttribute('href')).toBe(
    '/invitations?group=group-a',
  );
  expect(button('Try the original request again')).toBeUndefined();
  expect(button('Create invitation').disabled).toBe(true);
  expect(readAttempt()).toEqual(original);
  expect(
    requests.every((r) => !String(r.body.query).includes('resendInvitation')),
  ).toBe(true);
});
it('replaces invitation scope and ignores a late private listing response', async () => {
  let finish!: (value: unknown) => void;
  const initial = respond;
  respond = async (path, body) =>
    path === '/api/graphql'
      ? new Promise((done) => {
          finish = done;
        })
      : initial(path, body);
  await scoped('group-a', 'House');
  respond = async () => ({
    data: { ownerInvitations: { items: [], nextCursor: null } },
  });
  await scoped('group-b', 'Maui');
  await act(async () =>
    finish({
      data: {
        ownerInvitations: {
          items: [
            {
              id: 'invite-a',
              recipient: 'private@example.test',
              lifecycle: 'PENDING',
            },
          ],
          nextCursor: null,
        },
      },
    }),
  );
  expect(
    container.querySelector('[aria-label="People and invitations for Maui"]'),
  ).not.toBeNull();
  expect(container.textContent).not.toContain('private@example.test');
  expect(
    requests
      .filter((r) => String(r.body.query).includes('ownerInvitations'))
      .map((r) => r.body.variables),
  ).toEqual([
    { groupID: 'group-a', after: null },
    { groupID: 'group-b', after: null },
  ]);
});
it('shows retryable signout failure without redirect and suppresses duplicate attempts', async () => {
  profileResponder();
  await render('account');
  let finish!: (value: unknown) => void;
  sdk.signOut.mockImplementation(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  await act(async () => {
    button('Sign out of this session').click();
    button('Sign out of this session').click();
  });
  expect(sdk.signOut).toHaveBeenCalledTimes(1);
  await act(async () => finish({ error: { message: 'Unavailable' } }));
  expect(sdk.replace).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Alice');
  expect(button('Sign out of this session').disabled).toBe(false);
  sdk.signOut.mockImplementation(async () => {
    sdk.changed('SIGNED_OUT', null);
    return { error: null };
  });
  await click('Sign out of this session');
  expect(sdk.replace).toHaveBeenCalledWith('/sign-in');
  expect(sdk.signOut).toHaveBeenLastCalledWith({ scope: 'local' });
});
it('leaves untargeted legacy invitations as navigation guidance instead of choosing a workspace', async () => {
  await render('invitations');
  expect(button('Load my groups')).toBeUndefined();
  expect(button('Create invitation')).toBeUndefined();
  expect(
    requests.some((r) => String(r.body.query).includes('ownerInvitations')),
  ).toBe(false);
  for (const href of ['/household', '/groups', '/trips'])
    expect(container.querySelector(`a[href="${href}"]`)).not.toBeNull();
});

it('accepts the 120 code-point boundary and renders markup-shaped names as text', async () => {
  profileResponder('<img src=x onerror=alert(1)>');
  await render('account');
  expect(container.querySelector('img')).toBeNull();
  const name = '😀'.repeat(120);
  await fillName(name);
  respond = async (_path, body) => {
    expect(body.variables).toEqual({
      displayName: name,
      expectedDisplayName: '<img src=x onerror=alert(1)>',
    });
    return {
      data: {
        updateMyProfile: {
          __typename: 'Profile',
          id: 'user-a',
          displayName: name,
        },
      },
    };
  };
  await submitProfile();
  expect(container.textContent).toContain('Changes saved.');
});
it('preserves a rejected server-validation draft without reporting success', async () => {
  profileResponder();
  await render('account');
  await fillName('Draft');
  respond = async () => ({
    data: {
      updateMyProfile: { __typename: 'ProfileProblem', code: 'INVALID_INPUT' },
    },
  });
  await submitProfile();
  expect(
    (container.querySelector('#display-name') as HTMLInputElement).value,
  ).toBe('Draft');
  expect(container.textContent).not.toContain('Changes saved.');
  expect(button('Save changes').disabled).toBe(false);
});
it('requires reconciliation after a concurrent-edit conflict and never automatically resubmits', async () => {
  profileResponder();
  await render('account');
  await fillName('Draft');
  respond = async () => ({
    data: {
      updateMyProfile: { __typename: 'ProfileProblem', code: 'CONFLICT' },
    },
  });
  await submitProfile();
  expect(container.textContent).toContain('Your name changed elsewhere');
  expect(button('Save changes').disabled).toBe(true);
  expect(
    (container.querySelector('#display-name') as HTMLInputElement).value,
  ).toBe('Draft');
  profileResponder('Other edit');
  await click('Check current profile');
  expect(
    requests.filter((r) =>
      String(r.body.query).includes('mutation profileMutation'),
    ),
  ).toHaveLength(1);
  expect(
    (container.querySelector('#display-name') as HTMLInputElement).value,
  ).toBe('Draft');
});
it.each([
  [
    { id: 'home', kind: 'ORDINARY', isHousehold: true },
    '/household?tab=members#invitations',
  ],
  [
    { id: 'group-a', kind: 'ORDINARY', isHousehold: false },
    '/groups/group-a?tab=members#invitations',
  ],
  [
    { id: 'trip-a', kind: 'TRIP', isHousehold: false },
    '/trips/trip-a?tab=members#invitations',
  ],
])(
  'resolves an explicit authorized legacy target into its contextual destination',
  async (group, expected) => {
    window.history.replaceState(null, '', `/invitations?group=${group.id}`);
    const initial = respond;
    respond = async (path, body) =>
      path === '/api/graphql'
        ? {
            data: {
              group: {
                __typename: 'Group',
                ...group,
                name: 'Space',
                viewerMembership: { role: 'OWNER' },
              },
            },
          }
        : initial(path, body);
    await render('invitations');
    expect(sdk.replace).toHaveBeenCalledWith(expected);
    expect(
      requests.some((r) => String(r.body.query).includes('ownerInvitations')),
    ).toBe(false);
  },
);
it.each([
  { __typename: 'Problem', code: 'NOT_FOUND' },
  {
    __typename: 'Group',
    id: 'secret',
    name: 'Private space',
    viewerMembership: { role: 'MEMBER' },
  },
])(
  'does not disclose or open an inaccessible legacy invitation target',
  async (group) => {
    window.history.replaceState(null, '', '/invitations?group=secret');
    const initial = respond;
    respond = async (path, body) =>
      path === '/api/graphql' ? { data: { group } } : initial(path, body);
    await render('invitations');
    expect(sdk.replace).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Private space');
    expect(container.textContent).toContain('workspace is unavailable');
  },
);

it('preserves contextual Members query and invitation anchor through mount and reload', async () => {
  const url = '/trips/group-a?tab=members#invitations';
  window.history.replaceState(null, '', url);
  const initial = respond;
  respond = async (path, body) =>
    path === '/api/graphql'
      ? { data: { ownerInvitations: { items: [], nextCursor: null } } }
      : initial(path, body);
  await scoped('group-a', 'Maui');
  expect(
    window.location.pathname + window.location.search + window.location.hash,
  ).toBe(url);
  expect(requests.some((r) => r.path.endsWith('/start'))).toBe(false);
  await act(async () => root.render(<p>Reloading</p>));
  await scoped('group-a', 'Maui');
  expect(
    window.location.pathname + window.location.search + window.location.hash,
  ).toBe(url);
  expect(requests.some((r) => r.path.endsWith('/start'))).toBe(false);
});
it('does not sign out a newer account after a prior signout context-clear response arrives', async () => {
  profileResponder();
  await render('account');
  let finish!: (value: unknown) => void;
  respond = async (path) =>
    path.endsWith('/clear')
      ? new Promise((done) => {
          finish = done;
        })
      : profileResult('Bob');
  await click('Sign out of this session');
  await act(async () =>
    sdk.changed('SIGNED_IN', {
      user: { id: 'bob', email: 'bob@example.test' },
      access_token: 'bob-token',
    }),
  );
  await act(async () => finish({ code: 'CLEARED' }));
  expect(sdk.signOut).not.toHaveBeenCalled();
  expect(sdk.replace).not.toHaveBeenCalledWith('/sign-in');
  expect(
    (container.querySelector('#account-email') as HTMLInputElement).value,
  ).toBe('bob@example.test');
  expect(
    (container.querySelector('#display-name') as HTMLInputElement).value,
  ).toBe('Bob');
});

it('keeps a working sign-in form after rejected initial verification and a stale INITIAL_SESSION notification', async () => {
  sdk.rejected = true;
  await render('sign-in');
  expect(container.querySelector('#onboarding-email')).not.toBeNull();
  await act(async () => sdk.changed('INITIAL_SESSION', sdk.session));
  expect(container.querySelector('#onboarding-email')).not.toBeNull();
  expect(container.textContent).not.toContain('Continue to my account');
});
