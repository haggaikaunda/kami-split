// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { OnboardingEntry } from './entry';
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
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: sdk.session } }),
      onAuthStateChange: (changed: typeof sdk.changed) => {
        sdk.changed = changed;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      setSession: async () => ({ error: null }),
      updateUser: sdk.updateUser,
      verifyOtp: sdk.verifyOtp,
      signOut: async () => {
        sdk.changed('SIGNED_OUT', null);
        return { error: null };
      },
    },
  }),
}));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: sdk.replace }),
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
  sdk.updateUser.mockReset();
  sdk.verifyOtp.mockReset();
  sdk.replace.mockReset();
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
  await render('invitations');
  await click('Load my groups');
  await click('Manage invitations for House');
  await click('Resend and renew for seven days');
  const original = readAttempt();
  expect(original).toMatchObject({
    kind: 'RESEND',
    groupID: 'group-a',
    invitationID: 'invite-a',
  });
  expect(button('Resend and renew for seven days').disabled).toBe(true);
  await act(async () => root.render(<p>Elsewhere</p>));
  await render('invitations');
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
  expect(sdk.replace).toHaveBeenCalledWith('/auth/password');
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
  await render('invitations');
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
  await render('invitations');
  await click('Load my groups');
  await click('Manage invitations for House');
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
  await render('invitations');
  await click('Load my groups');
  await click('Manage invitations for Group');
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
  expect(container.textContent).toContain('Create your Kami Split account');
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
it('loads ordinary account groups automatically and links directly to their real experience', async () => {
  respond = async () => ({
    data: {
      viewer: {
        __typename: 'Viewer',
        groups: [{ id: 'group-a', name: 'Household' }],
      },
    },
  });
  await render('account');
  expect(button('Load my groups')).toBeUndefined();
  expect(
    container.querySelector('a[href="/groups?group=group-a"]')?.textContent,
  ).toBe('Household');
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
  expect(sdk.replace).toHaveBeenCalledWith('/auth/password');
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
  expect(container.textContent).toContain(
    'Reopen the original application invitation link',
  );
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
      ? { data: { viewer: { __typename: 'Viewer', groups: [] } } }
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
    expect(container.querySelectorAll('.onboarding-art')).toHaveLength(1);
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
