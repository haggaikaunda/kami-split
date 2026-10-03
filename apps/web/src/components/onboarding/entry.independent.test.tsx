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
    button('Join group').click();
    button('Join group').click();
  });
  expect(requests.filter((item) => item.path.endsWith('/accept'))).toHaveLength(
    1,
  );
  const original = readAttempt();
  expect(original?.kind).toBe('ACCEPT');
  await act(async () => reject(new Error('UNAVAILABLE')));
  expect(button('Join group').disabled).toBe(true);
  expect(readAttempt()).toEqual(original);
  respond = async (_path, body) => {
    expect(body.variables).toEqual({ kind: 'ACCEPT', key: original!.key });
    return { data: { invitationAction: { outcome: 'NOT_OBSERVED' } } };
  };
  await click('Recover original action');
  expect(readAttempt()).toEqual(original);
  respond = async () => ({
    data: {
      invitationAction: { outcome: 'HISTORICAL_ACCEPTANCE', hasAccess: false },
    },
  });
  await click('Recover original action');
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
  await click('Join group');
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
  await click('Join group');
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
  await click('Join group');
  expect(container.textContent).toContain('Your session has expired');
  expect(readAttempt()?.kind).toBe('ACCEPT');
  expect(button('Join group').disabled).toBe(true);
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
  await click('Recover original action');
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
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(sdk.updateUser).toHaveBeenCalledOnce();
  expect(sdk.updateUser).toHaveBeenCalledWith({
    password: 'SyntheticPassword162!',
  });
  expect(container.textContent).toContain(
    'Password saved. Return to your invitation to explicitly join',
  );
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
  await click('Join group');
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
  await click('Join group');
  const original = readAttempt()!;
  respond = async () => ({
    data: { invitationAction: { outcome: 'NOT_OBSERVED' } },
  });
  await click('Recover original action');
  expect(readAttempt()).toEqual(original);
  respond = async (path, body) => {
    expect(path).toBe('/api/onboarding/accept');
    expect(body).toEqual({
      key: original.key,
      tokenDigest: original.tokenDigest,
    });
    return { code: 'APPLIED', groupID: 'group-a', hasAccess: true };
  };
  await click('Retry original action with the same key');
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
  await click('Retry original action with the same key');
  expect(readAttempt()).toEqual(original);
  respond = async () => ({
    data: { invitationAction: { outcome: 'NOT_OBSERVED' } },
  });
  await click('Recover original action');
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
  await click('Retry original action with the same key');
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
  await click('Retry original action with the same key');
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
  await click('Join group');
  const original = readAttempt()!;
  expect(original.tokenDigest).toBe(originalDigest);
  expect(attempts).toEqual([
    { key: original.key, tokenDigest: originalDigest },
  ]);
  expect(container.textContent).not.toContain('You have joined the group');
  await click('Retry original action with the same key');
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
  await click('Join group');
  expect(container.textContent).toContain(
    'Reopen the original application invitation link in this tab',
  );
  expect(readAttempt()).toBeNull();
  expect(requests.filter((item) => item.path.endsWith('/accept'))).toHaveLength(
    0,
  );
});
it('removes the tab invitation binding and pending action when the session signs out', async () => {
  saveAttempt({ kind: 'ACCEPT', key, tokenDigest: 'a'.repeat(64) });
  await render('join');
  await act(async () => sdk.changed('SIGNED_OUT', null));
  expect(sessionStorage.getItem('kami-onboarding-link-digest')).toBeNull();
  expect(readAttempt()).toBeNull();
  expect(container.textContent).not.toContain('Private group');
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
