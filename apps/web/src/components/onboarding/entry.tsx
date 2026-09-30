'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  createClient,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import {
  actionFields,
  jsonRequest,
  loadClient,
  readAttempt,
  recoveryQuery,
  RequestEpoch,
  saveAttempt,
  type Attempt,
} from '@/lib/onboarding/client';
import './onboarding.css';

type Mode =
  'sign-in' | 'join' | 'confirm' | 'password' | 'account' | 'invitations';
type Group = { id: string; name: string };
type Invite = {
  kind: string;
  id: string;
  recipient: string | null;
  expiresAt: string;
  lifecycle: string;
  actionID: string | null;
  delivery: string;
};
type Receipt = {
  outcome?: string;
  code?: string;
  actionID?: string;
  groupID?: string;
  delivery?: string;
  committedExpiresAt?: string;
  currentExpiresAt?: string;
  hasAccess?: boolean;
};
const messages: Record<string, string> = {
  INVALID_EMAIL: 'Enter a valid email address. No invitation was saved.',
  INVALID_INPUT: 'Check the original action inputs before submitting again.',
  ORIGINAL_LINK_REQUIRED:
    'Reopen the original application invitation link in this tab. Another tab may have changed the current invitation, or this email callback opened in a new tab.',
  UNAVAILABLE:
    'This service is temporarily unavailable. If you submitted an action, recover its result before trying a new action.',
  UNAUTHENTICATED: 'Your session has expired. Sign in again to continue.',
  VERIFY_EMAIL: 'Verify your current email address before joining.',
  WRONG_ACCOUNT:
    'This invitation is for a different email address. Sign out, then use the invited account.',
  ACCESS_DISABLED: 'Application access is disabled for this account.',
  ACCESS_DENIED: 'This account cannot manage these invitations.',
  CONTEXT_EXPIRED:
    'This onboarding session expired. Reopen the invitation, or start password recovery again.',
  UNAVAILABLE_LINK:
    'This invitation is unavailable. It may have expired, been revoked, or already been accepted. Ask the owner for help.',
  INVALID_CALLBACK:
    'This email link is invalid, expired, already used, or was opened in a different browser. Request another email in this browser.',
  NEW_TARGETED_INVITATION_REQUIRED:
    'Ask the owner for a new invitation to return to this group.',
  NOT_OBSERVED:
    'The original action has no visible result yet. It may still be processing. Keep this recovery context and check again.',
  RATE_LIMITED: 'Too many attempts. Wait a minute before trying again.',
  KEY_REUSED:
    'This action key belongs to different inputs. Recover the original action.',
  NOT_CLAIMABLE:
    'This send is already processing, complete, or no longer eligible. Refresh its status before choosing a new resend.',
};
function explain(code: string) {
  return (
    messages[code] ??
    'The operation could not be completed. Check the current state before retrying.'
  );
}

export function OnboardingEntry({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [preview, setPreview] = useState<{
    groupName: string;
    inviterDisplayName: string;
  } | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [group, setGroup] = useState('');
  const [invites, setInvites] = useState<Invite[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [callback, setCallback] = useState<{
    token_hash: string;
    type: 'invite' | 'recovery';
    state: string;
  } | null>(null);
  const epoch = useRef(new RequestEpoch());
  const authTicket = useRef(0);
  const installing = useRef(false);
  const alive = useRef(true);
  const status = useRef<HTMLParagraphElement>(null);
  const contextReady = useRef(false);
  const initialFragment = useRef<string | null>(null);
  const pending = (value: Attempt | null) => {
    saveAttempt(value);
    setAttempt(value);
  };
  const call = (path: string, input: unknown) =>
    epoch.current.run((signal) =>
      jsonRequest(path, input, sessionRef.current, signal),
    );
  const graph = async (query: string, variables: unknown = {}) => {
    const value = await call('/api/graphql', { query, variables });
    if (value.errors?.length)
      throw new Error(value.errors[0].extensions?.code ?? 'UNAVAILABLE');
    return value.data;
  };
  const tell = (message: string, error = false) => {
    setNotice(message);
    setFailed(error);
  };
  const run = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice('');
    setFailed(false);
    try {
      await work();
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNAVAILABLE';
      if (
        alive.current &&
        code !== 'SESSION_CHANGED' &&
        !(error instanceof DOMException && error.name === 'AbortError')
      )
        tell(explain(code), true);
    } finally {
      busyRef.current = false;
      if (alive.current) {
        setBusy(false);
        requestAnimationFrame(() => status.current?.focus());
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    let active = true;
    const requests = epoch.current;
    const tickets = authTicket;
    initialFragment.current ??= window.location.hash.slice(1);
    const fragment = initialFragment.current;
    if (fragment)
      window.history.replaceState(null, '', window.location.pathname);
    let dispose: (() => void) | undefined;
    void (async () => {
      try {
        const sdk = await loadClient();
        if (!active) return;
        setClient(sdk);
        const { data } = await sdk.auth.getSession();
        if (!active) return;
        sessionRef.current = data.session;
        setSession(data.session);
        const storedUser = sessionStorage.getItem('kami-onboarding-subject');
        if (storedUser && storedUser !== data.session?.user.id)
          saveAttempt(null);
        if (data.session)
          sessionStorage.setItem(
            'kami-onboarding-subject',
            data.session.user.id,
          );
        setAttempt(readAttempt());
        const subscription = sdk.auth.onAuthStateChange((event, current) => {
          if (!active) return;
          const previous = sessionRef.current?.user.id;
          if (previous !== current?.user.id || event === 'SIGNED_OUT') {
            requests.reset();
            if (!installing.current) authTicket.current++;
            setGroups([]);
            setInvites([]);
            setReceipt(null);
            setGroup('');
            setEmail('');
            setPassword('');
            if (previous) {
              saveAttempt(null);
              sessionStorage.removeItem('kami-onboarding-link-digest');
              setAttempt(null);
              setPreview(null);
              void fetch('/api/onboarding/clear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
              });
              contextReady.current = false;
            }
            if (current)
              sessionStorage.setItem(
                'kami-onboarding-subject',
                current.user.id,
              );
            else sessionStorage.removeItem('kami-onboarding-subject');
          }
          sessionRef.current = current;
          setSession(current);
        });
        dispose = () => subscription.data.subscription.unsubscribe();
        if (mode === 'join') {
          if (fragment) {
            const bytes = await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(fragment),
            );
            const digest = Array.from(new Uint8Array(bytes), (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join('');
            const original = readAttempt();
            if (
              original?.kind === 'ACCEPT' &&
              original.tokenDigest &&
              original.tokenDigest !== digest
            )
              throw new Error('ORIGINAL_LINK_REQUIRED');
            sessionStorage.setItem('kami-onboarding-link-digest', digest);
            await requests.run((signal) =>
              jsonRequest(
                '/api/onboarding/start',
                { token: fragment },
                data.session,
                signal,
              ),
            );
          }
          const result = await requests.run((signal) =>
            jsonRequest('/api/onboarding/preview', {}, data.session, signal),
          );
          setPreview(result);
          contextReady.current = true;
        } else if (mode === 'confirm') {
          const parts = new URLSearchParams(fragment);
          const type = parts.get('type');
          const token_hash = parts.get('token_hash');
          const state = parts.get('state');
          if (
            !token_hash ||
            !/^(?:[a-fA-F0-9]{56}|[a-fA-F0-9]{64})$/.test(token_hash) ||
            !state ||
            (type !== 'invite' && type !== 'recovery') ||
            [...parts.keys()].some(
              (key) => !['type', 'token_hash', 'state'].includes(key),
            )
          )
            throw new Error('INVALID_CALLBACK');
          setCallback({ token_hash, type, state });
        }
      } catch (error) {
        if (active)
          tell(
            explain(error instanceof Error ? error.message : 'UNAVAILABLE'),
            true,
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      alive.current = false;
      tickets.current++;
      requests.reset();
      dispose?.();
    };
  }, [mode]);

  const ensureContext = async () => {
    if (!contextReady.current) {
      await call('/api/onboarding/start', {});
      contextReady.current = true;
    }
  };
  const auth = async (kind: 'login' | 'verify') => {
    if (!client) throw new Error('UNAVAILABLE');
    if (kind === 'verify' && session) throw new Error('INVALID_CALLBACK');
    const ticket = ++authTicket.current;
    // Isolated nonpersistent client prevents a late login/callback response from
    // replacing another browser session before the epoch has been checked.
    const config = await fetch('/api/onboarding-config', {
      cache: 'no-store',
    }).then((r) => r.json());
    const temporary = createClient(config.url, config.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    let result;
    if (kind === 'verify') {
      if (!callback) throw new Error('INVALID_CALLBACK');
      await call('/api/onboarding/callback-state', { state: callback.state });
      result = await temporary.auth.verifyOtp({
        token_hash: callback.token_hash,
        type: callback.type,
      });
      setCallback(null);
    } else
      result = await temporary.auth.signInWithPassword({ email, password });
    setPassword('');
    if (ticket !== authTicket.current || !alive.current) return;
    if (result.error || !result.data.session) {
      tell(
        kind === 'verify'
          ? explain('INVALID_CALLBACK')
          : 'Sign-in failed. Check your email and password, verify your email, or reset your password.',
        true,
      );
      return;
    }
    installing.current = true;
    try {
      const saved = await client.auth.setSession(result.data.session);
      if (saved.error) throw new Error('UNAVAILABLE');
    } finally {
      installing.current = false;
    }
    if (!alive.current || ticket !== authTicket.current) return;
    router.replace(
      kind === 'verify'
        ? '/auth/password'
        : mode === 'join'
          ? '/join'
          : '/account',
    );
  };
  const loadGroups = async () => {
    const data = await graph(
      'query { viewer { __typename ... on Viewer { groups { id name } } ... on ViewerAccess { state } ... on Problem { code } } }',
    );
    if (data.viewer.__typename !== 'Viewer') {
      tell(
        data.viewer.state === 'UNPROVISIONED'
          ? 'You are signed in. Open your invitation and explicitly join to gain group access.'
          : explain(data.viewer.state ?? data.viewer.code),
        true,
      );
      return;
    }
    setGroups(data.viewer.groups);
    if (!data.viewer.groups.length)
      tell('No accessible groups yet. Open your invitation to join.');
  };
  const loadInvites = async (id: string, after: string | null = null) => {
    const data = await graph(
      'query($groupID:ID!,$after:ID){ownerInvitations(groupID:$groupID,first:20,after:$after){__typename ... on OwnerInvitationPage { items{id kind recipient expiresAt lifecycle actionID delivery} nextCursor } ... on InvitationProblem {code}}}',
      { groupID: id, after },
    );
    if (data.ownerInvitations.code) throw new Error(data.ownerInvitations.code);
    setInvites((old) =>
      after
        ? [...old, ...data.ownerInvitations.items]
        : data.ownerInvitations.items,
    );
    setNext(data.ownerInvitations.nextCursor);
    if (!data.ownerInvitations.items.length && !after)
      tell('No invitations yet.');
  };
  const showReceipt = (value: Receipt) => {
    if (value.code) {
      if (value.code === 'INVALID_EMAIL' || value.code === 'INVALID_INPUT')
        pending(null);
      throw new Error(value.code);
    }
    setReceipt(value);
    if (value.outcome === 'NOT_OBSERVED' || value.outcome === 'KEY_REUSED') {
      tell(explain(value.outcome));
      return;
    }
    pending(null);
    if (value.hasAccess && value.groupID)
      tell(
        'You have joined the group. Continue to your account to see your admitted groups.',
      );
    else if (value.outcome === 'SAVED' || value.outcome === 'APPLIED')
      tell(
        value.delivery === 'NOT_REQUESTED'
          ? 'Shared link change saved. No invitation email was sent.'
          : 'Invitation change saved. Check the separate send status below.',
      );
    else if (value.outcome === 'EXISTING')
      tell(
        'An outstanding invitation already exists. No new email was requested and its expiry was not changed.',
      );
    else if (value.outcome === 'HISTORICAL_ACCEPTANCE')
      tell(
        'Your earlier acceptance is recorded, but you no longer have access. Ask the owner for a new invitation.',
      );
    else if (
      value.outcome === 'ALREADY_ACCEPTED' ||
      value.outcome === 'ALREADY_REVOKED'
    )
      tell('This invitation is terminal and cannot be resent or renewed.');
    else tell(explain(value.outcome ?? 'UNAVAILABLE'), true);
  };
  const recover = async (value = attempt) => {
    if (!value) return;
    const data = await graph(recoveryQuery, {
      kind: value.kind,
      key: value.key,
    });
    showReceipt(data.invitationAction);
  };
  const send = async (actionID: string) => {
    const data = await graph(
      'mutation($actionID:ID!){retryInvitationDelivery(actionID:$actionID){__typename ... on InvitationDeliveryResult {status} ... on InvitationProblem {code}}}',
      { actionID },
    );
    if (data.retryInvitationDelivery.code)
      throw new Error(data.retryInvitationDelivery.code);
    tell(
      'Send attempted. Refresh invitations to see the recorded provider status; provider acceptance does not guarantee arrival.',
    );
  };
  const ownerAction = async (
    kind: 'CREATE' | 'RESEND' | 'REVOKE' | 'CREATE_SHARED' | 'RENEW_SHARED',
    id?: string,
    original?: Attempt,
  ) => {
    const value: Attempt = original ?? {
      kind,
      key: crypto.randomUUID(),
      groupID: group,
      ...(id ? { invitationID: id } : {}),
    };
    pending(value);
    const name =
      kind === 'CREATE_SHARED'
        ? 'createSharedInvitation'
        : kind === 'RENEW_SHARED'
          ? 'renewSharedInvitation'
          : kind === 'CREATE'
            ? 'createTargetedInvitation'
            : kind === 'RESEND'
              ? 'resendInvitation'
              : 'revokeInvitation';
    const query =
      kind === 'CREATE_SHARED'
        ? `mutation($groupID:ID!,$key:OperationKey!){${name}(groupID:$groupID,key:$key){${actionFields}}}`
        : kind === 'CREATE'
          ? `mutation($groupID:ID!,$email:String!,$key:OperationKey!){${name}(groupID:$groupID,email:$email,key:$key){${actionFields}}}`
          : `mutation($groupID:ID!,$id:ID!,$key:OperationKey!){${name}(groupID:$groupID,id:$id,key:$key){${actionFields}}}`;
    const data = await graph(query, {
      groupID: value.groupID,
      id: value.invitationID,
      email,
      key: value.key,
    });
    const result = data[name] as Receipt;
    showReceipt(result);
    if (
      result.actionID &&
      result.delivery === 'PENDING' &&
      result.outcome !== 'EXISTING' &&
      kind !== 'REVOKE'
    ) {
      await send(result.actionID);
    }
    await loadInvites(value.groupID ?? group);
  };
  const title = {
    'sign-in': 'Sign in',
    join: 'Join your group',
    confirm: 'Verify your email link',
    password: 'Set your password',
    account: 'Your account',
    invitations: 'Manage invitations',
  }[mode];
  return (
    <main className="onboarding" id="page-content">
      <header>
        <Link href="/account">Kami Split</Link>
        <span>Private expense sharing</span>
      </header>
      <h1>{title}</h1>
      {loading ? (
        <p role="status">Loading secure account access…</p>
      ) : (
        <>
          <p
            ref={status}
            tabIndex={-1}
            role={failed ? 'alert' : 'status'}
            className={failed ? 'onboarding-error' : ''}
          >
            {busy ? 'Working…' : notice}
          </p>
          {!client && (
            <p>
              Account services are not configured or cannot be reached. Try
              again later.
            </p>
          )}
          {session && (
            <div className="onboarding-session">
              <p>Signed in as {session.user.email}</p>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    authTicket.current++;
                    epoch.current.reset();
                    await call('/api/onboarding/clear', {}).catch(
                      () => undefined,
                    );
                    const out = await client?.auth.signOut({ scope: 'local' });
                    if (out?.error) throw new Error('UNAVAILABLE');
                    pending(null);
                    router.replace('/sign-in');
                  })
                }
              >
                Sign out of this session
              </button>
              <p>
                Other devices may remain signed in. Existing access tokens can
                remain valid for up to 15 minutes.
              </p>
            </div>
          )}
          {preview && (
            <section>
              <h2>{preview.groupName}</h2>
              <p>
                Invited by {preview.inviterDisplayName}. Joining grants ordinary
                membership and the group’s full expense history.
              </p>
            </section>
          )}
          {(mode === 'sign-in' || mode === 'join') && !session && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => auth('login'));
              }}
            >
              <label htmlFor="onboarding-email">Email address</label>
              <input
                id="onboarding-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                disabled={busy}
                onChange={(e) => setEmail(e.target.value)}
              />
              <label htmlFor="onboarding-password">Password</label>
              <input
                id="onboarding-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button disabled={busy || !client}>Sign in</button>
              <button
                type="button"
                disabled={busy || !email || !client}
                onClick={() =>
                  void run(async () => {
                    await ensureContext();
                    const out = await call('/api/onboarding/recover', {
                      email,
                    });
                    tell(out.message);
                  })
                }
              >
                Forgot password
              </button>
              {mode === 'join' && preview && (
                <button
                  type="button"
                  disabled={busy || !email || !client}
                  onClick={() =>
                    void run(async () => {
                      const out = await call('/api/onboarding/provision', {
                        email,
                        tokenDigest:
                          sessionStorage.getItem(
                            'kami-onboarding-link-digest',
                          ) ?? '',
                      });
                      tell(out.message);
                    })
                  }
                >
                  Email me account verification
                </button>
              )}
              <p>
                Shared links require an existing registered account and verified
                email. New accounts need a targeted email invitation; the
                verification button applies only to targeted invitations.
                Existing users reuse their account. Open verification and
                recovery emails in this browser within 15 minutes.
              </p>
            </form>
          )}
          {mode === 'join' && session && preview && (
            <button
              disabled={busy || !!attempt}
              onClick={() =>
                void run(async () => {
                  const tokenDigest = sessionStorage.getItem(
                    'kami-onboarding-link-digest',
                  );
                  if (!tokenDigest) throw new Error('ORIGINAL_LINK_REQUIRED');
                  const value: Attempt = {
                    kind: 'ACCEPT',
                    key: crypto.randomUUID(),
                    tokenDigest,
                  };
                  pending(value);
                  const out = await call('/api/onboarding/accept', {
                    key: value.key,
                    tokenDigest: value.tokenDigest,
                  });
                  showReceipt({
                    outcome: out.code,
                    groupID: out.groupID,
                    hasAccess: out.hasAccess,
                  });
                })
              }
            >
              Join group
            </button>
          )}
          {mode === 'confirm' && callback && !session && (
            <>
              <p>
                Continue to verify this email link and set your password.
                Opening the email alone does not join a group.
              </p>
              <button
                disabled={busy}
                onClick={() => void run(() => auth('verify'))}
              >
                Continue with email link
              </button>
            </>
          )}
          {mode === 'confirm' && session && (
            <p>
              Sign out before opening a verification or recovery email for
              another account. Then request a new email.
            </p>
          )}
          {mode === 'password' && session && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const current = sessionRef.current;
                  if (!current) throw new Error('UNAUTHENTICATED');
                  await epoch.current.run(async (signal) => {
                    const config = await fetch('/api/onboarding-config', {
                      cache: 'no-store',
                      signal,
                    }).then((r) => r.json());
                    const isolated = createClient(config.url, config.key, {
                      auth: {
                        persistSession: false,
                        autoRefreshToken: false,
                        detectSessionInUrl: false,
                      },
                    });
                    const installed = await isolated.auth.setSession(current);
                    if (installed.error || signal.aborted)
                      throw new Error('SESSION_CHANGED');
                    const out = await isolated.auth.updateUser({ password });
                    if (out.error) throw new Error('UNAVAILABLE');
                  });
                  setPassword('');
                  tell(
                    'Password saved. Return to your invitation to explicitly join, or continue to your account.',
                  );
                });
              }}
            >
              <label htmlFor="new-password">
                New password (at least 12 characters)
              </label>
              <input
                id="new-password"
                type="password"
                minLength={12}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
              <button disabled={busy}>Save password</button>
              <Link href="/join">Return to invitation</Link>
            </form>
          )}
          {(mode === 'account' || mode === 'invitations') && session && (
            <section>
              <button disabled={busy} onClick={() => void run(loadGroups)}>
                Load my groups
              </button>
              {groups.length > 0 && (
                <ul>
                  {groups.map((item) => (
                    <li key={item.id}>
                      <strong>{item.name}</strong>{' '}
                      <button
                        disabled={busy || !!attempt}
                        onClick={() =>
                          void run(async () => {
                            setGroup('');
                            setInvites([]);
                            await loadInvites(item.id);
                            setGroup(item.id);
                          })
                        }
                      >
                        Manage invitations for {item.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {group && (
                <>
                  <h2>Group invitations</h2>
                  <p>
                    Shared links admit verified first-time members who
                    explicitly join. Forwarded links work too. Former members
                    need a new targeted invitation. No application email is sent
                    for shared links.
                  </p>
                  <button
                    disabled={busy || !!attempt}
                    onClick={() => void run(() => ownerAction('CREATE_SHARED'))}
                  >
                    Create or retrieve shared link
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void run(() => loadInvites(group))}
                  >
                    Refresh invitations
                  </button>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(() => ownerAction('CREATE'));
                    }}
                  >
                    <label htmlFor="invite-email">Invitee email address</label>
                    <input
                      id="invite-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={busy || !!attempt}
                    />
                    <button disabled={busy || !!attempt}>
                      Create invitation
                    </button>
                  </form>
                  <ul>
                    {invites.map((item) => (
                      <li key={item.id}>
                        <strong>
                          {item.kind === 'SHARED'
                            ? 'Shared group link'
                            : (item.recipient ?? 'Recipient removed')}
                        </strong>
                        <p>
                          {item.lifecycle} · Expires{' '}
                          {new Date(item.expiresAt).toLocaleString()}
                        </p>
                        {item.kind !== 'SHARED' && (
                          <p>
                            Send status: {item.delivery}. Provider acceptance
                            does not confirm recipient delivery.
                          </p>
                        )}
                        {!['ACCEPTED', 'REVOKED'].includes(item.lifecycle) && (
                          <div className="onboarding-actions">
                            {item.kind === 'SHARED' && (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    const result = await call(
                                      '/api/onboarding/copy-shared',
                                      { groupID: group, invitationID: item.id },
                                    );
                                    await navigator.clipboard.writeText(
                                      result.link,
                                    );
                                    tell(
                                      'Shared link copied. Copying does not renew it. Distribute it only to people you want to join.',
                                    );
                                  })
                                }
                              >
                                Copy shared link
                              </button>
                            )}
                            <button
                              disabled={busy || !!attempt}
                              onClick={() =>
                                void run(() =>
                                  ownerAction(
                                    item.kind === 'SHARED'
                                      ? 'RENEW_SHARED'
                                      : 'RESEND',
                                    item.id,
                                  ),
                                )
                              }
                            >
                              {item.kind === 'SHARED'
                                ? 'Renew shared link for seven days'
                                : 'Resend and renew for seven days'}
                            </button>
                            <button
                              disabled={busy || !!attempt}
                              onClick={() =>
                                void run(() => ownerAction('REVOKE', item.id))
                              }
                            >
                              Revoke invitation
                            </button>
                            {item.actionID &&
                              [
                                'PENDING',
                                'UNKNOWN',
                                'FAILED_DEFINITE',
                              ].includes(item.delivery) && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void run(async () => {
                                      await send(item.actionID!);
                                      await loadInvites(group);
                                    })
                                  }
                                >
                                  Retry same email without renewing
                                </button>
                              )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  {next && (
                    <button
                      disabled={busy}
                      onClick={() => void run(() => loadInvites(group, next))}
                    >
                      Load more invitations
                    </button>
                  )}
                </>
              )}
            </section>
          )}
          {attempt && session && (
            <aside>
              <h2>Unfinished action</h2>
              <p>
                Your original {attempt.kind.toLowerCase()} action is retained. A
                timeout does not prove it failed.
              </p>
              <button disabled={busy} onClick={() => void run(() => recover())}>
                Recover original action
              </button>
              {attempt.kind === 'CREATE' && (
                <>
                  <label htmlFor="original-invite-email">
                    Original invitee email (re-enter after navigation)
                  </label>
                  <input
                    id="original-invite-email"
                    type="email"
                    value={email}
                    disabled={busy}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </>
              )}
              <button
                disabled={busy || (attempt.kind === 'CREATE' && !email)}
                onClick={() =>
                  void run(async () => {
                    if (attempt.kind === 'ACCEPT') {
                      const currentDigest = sessionStorage.getItem(
                        'kami-onboarding-link-digest',
                      );
                      if (
                        attempt.tokenDigest &&
                        attempt.tokenDigest !== currentDigest
                      )
                        throw new Error('ORIGINAL_LINK_REQUIRED');
                      const out = await call('/api/onboarding/accept', {
                        key: attempt.key,
                        tokenDigest: attempt.tokenDigest,
                      });
                      showReceipt({
                        outcome: out.code,
                        groupID: out.groupID,
                        hasAccess: out.hasAccess,
                      });
                    } else
                      await ownerAction(
                        attempt.kind,
                        attempt.invitationID,
                        attempt,
                      );
                  })
                }
              >
                Retry original action with the same key
              </button>
              <p>
                Retry only the original inputs. A concurrent completion is safe
                with this same key; never replace it merely because recovery has
                not observed a result.
              </p>
            </aside>
          )}
          {receipt && (
            <section>
              <h2>Action result</h2>
              <p>{receipt.outcome}</p>
              {receipt.committedExpiresAt && (
                <p>
                  Expiry saved by this action:{' '}
                  {new Date(receipt.committedExpiresAt).toLocaleString()}
                </p>
              )}
              {receipt.currentExpiresAt && (
                <p>
                  Current expiry:{' '}
                  {new Date(receipt.currentExpiresAt).toLocaleString()}
                </p>
              )}
              {receipt.delivery && <p>Send status: {receipt.delivery}</p>}
            </section>
          )}
          <nav aria-label="Account navigation">
            <Link href="/account">Your account</Link>
            <Link href="/join">Return to invitation</Link>
            {!session && (
              <Link href="/sign-in">Sign in or recover password</Link>
            )}
          </nav>
        </>
      )}
    </main>
  );
}
