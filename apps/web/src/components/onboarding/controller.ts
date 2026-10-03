'use client';
import { explain } from './messages';
import { useOwnerInvitations } from './owner-controller';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  createClient,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import {
  jsonRequest,
  loadClient,
  readAttempt,
  recoveryQuery,
  RequestEpoch,
  saveAttempt,
  type Attempt,
} from '@/lib/onboarding/client';

export type Mode =
  'sign-in' | 'join' | 'confirm' | 'password' | 'account' | 'invitations';
export type Receipt = {
  outcome?: string;
  code?: string;
  actionID?: string;
  groupID?: string;
  delivery?: string;
  committedExpiresAt?: string;
  currentExpiresAt?: string;
  hasAccess?: boolean;
};
export function useOnboarding(mode: Mode, fragment?: string) {
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
  const [step, setStep] = useState('landing');
  const [wrongAccount, setWrongAccount] = useState(false);
  const switching = useRef(false);
  const [preview, setPreview] = useState<{
    kind?: 'TARGETED' | 'SHARED';
    groupName: string;
    inviterDisplayName: string;
  } | null>(null);
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
  const contextReady = useRef(false);
  const initialFragment = useRef<string | null>(fragment ?? null);
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
      }
    }
  };
  const {
    groups,
    setGroups,
    group,
    setGroup,
    invites,
    setInvites,
    next,
    loadGroups,
    loadInvites,
    send,
    ownerAction,
  } = useOwnerInvitations({ graph, tell, pending, showReceipt, email });
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
            if (previous && !switching.current) {
              saveAttempt(null);
              sessionStorage.removeItem('kami-onboarding-link-digest');
              setAttempt(null);
              setPreview(null);
              // Auth events are broadcast across tabs. Only the explicit
              // sign-out initiator clears the shared server context; a passive
              // observer must not erase another tab's invitation switch.
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
        if (mode === 'account' && data.session) {
          const result = await requests.run((signal) =>
            jsonRequest(
              '/api/graphql',
              {
                query:
                  'query { viewer { __typename ... on Viewer { groups { id name } } ... on ViewerAccess { state } ... on Problem { code } } }',
              },
              data.session,
              signal,
            ),
          );
          if (result.data?.viewer?.__typename === 'Viewer')
            setGroups(result.data.viewer.groups);
          else tell('You are signed in. Open an invitation to join a group.');
        }
        if (
          mode === 'join' ||
          (mode === 'password' &&
            sessionStorage.getItem('kami-onboarding-link-digest'))
        ) {
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
  }, [mode, setGroup, setGroups, setInvites]);

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
      const context = await call('/api/onboarding/callback-state', {
        state: callback.state,
      });
      if (context.tokenDigest)
        sessionStorage.setItem(
          'kami-onboarding-link-digest',
          context.tokenDigest,
        );
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
    sessionRef.current = result.data.session;
    setSession(result.data.session);
    if (kind === 'login' && mode === 'join') setStep('join');
    router.replace(
      kind === 'verify'
        ? '/auth/password'
        : mode === 'join'
          ? '/join'
          : '/account',
    );
  };
  function showReceipt(value: Receipt) {
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
    if (value.hasAccess && value.groupID) {
      setStep('success');
      tell('You have joined the group.');
    } else if (value.outcome === 'SAVED' || value.outcome === 'APPLIED')
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
  }
  const recover = async (value = attempt) => {
    if (!value) return;
    const data = await graph(recoveryQuery, {
      kind: value.kind,
      key: value.key,
    });
    showReceipt(data.invitationAction);
  };
  const signOut = async (preserveInvitation = false) => {
    authTicket.current++;
    epoch.current.reset();
    switching.current = preserveInvitation;
    try {
      if (!preserveInvitation) await call('/api/onboarding/clear', {});
      const out = await client?.auth.signOut({ scope: 'local' });
      if (out?.error) throw new Error('UNAVAILABLE');
      pending(null);
      setSession(null);
      sessionRef.current = null;
      setWrongAccount(false);
      setStep('landing');
      if (!preserveInvitation) router.replace('/sign-in');
    } finally {
      switching.current = false;
    }
  };
  const targeted = async () => {
    const ticket = ++authTicket.current;
    let proof;
    try {
      proof = await call('/api/onboarding/targeted-continuation', {
        tokenDigest:
          sessionStorage.getItem('kami-onboarding-link-digest') ?? '',
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'WRONG_ACCOUNT') {
        setWrongAccount(true);
        return;
      }
      throw error;
    }
    if (proof.code === 'ALREADY_AUTHENTICATED') {
      setStep('join');
      return;
    }
    const config = await fetch('/api/onboarding-config', {
      cache: 'no-store',
    }).then((r) => r.json());
    const isolated = createClient(config.url, config.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const out = await isolated.auth.verifyOtp({
      token_hash: proof.tokenHash,
      type: proof.type,
    });
    if (ticket !== authTicket.current || !alive.current) return;
    if (out.error || !out.data.session || !client)
      throw new Error('INVALID_CALLBACK');
    installing.current = true;
    try {
      const installed = await client.auth.setSession(out.data.session);
      if (installed.error) throw new Error('UNAVAILABLE');
    } finally {
      installing.current = false;
    }
    if (ticket !== authTicket.current || !alive.current) return;
    sessionRef.current = out.data.session;
    setSession(out.data.session);
    setStep(proof.needsPassword ? 'password' : 'join');
  };
  const provision = async () => {
    await call('/api/onboarding/provision', {
      email,
      tokenDigest: sessionStorage.getItem('kami-onboarding-link-digest') ?? '',
    });
    setStep('check-email');
  };
  const recoverPassword = async () => {
    await ensureContext();
    await call('/api/onboarding/recover', { email });
    tell(
      "If there's a Kami Split account for that address, you'll receive a reset link. Open it in this browser.",
    );
  };
  const savePassword = async () => {
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
      if (installed.error || signal.aborted) throw new Error('SESSION_CHANGED');
      const out = await isolated.auth.updateUser({ password });
      if (out.error) throw new Error('UNAVAILABLE');
    });
    setPassword('');
    setStep(preview?.kind === 'TARGETED' ? 'join' : 'ready');
  };
  const accept = async () => {
    const tokenDigest = sessionStorage.getItem('kami-onboarding-link-digest');
    if (!tokenDigest) throw new Error('ORIGINAL_LINK_REQUIRED');
    const value: Attempt = {
      kind: 'ACCEPT',
      key: crypto.randomUUID(),
      tokenDigest,
    };
    pending(value);
    const out = await call('/api/onboarding/accept', {
      key: value.key,
      tokenDigest,
    });
    if (out.code === 'WRONG_ACCOUNT') {
      pending(null);
      setWrongAccount(true);
      return;
    }
    showReceipt({
      outcome: out.code,
      groupID: out.groupID,
      hasAccess: out.hasAccess,
    });
  };
  return {
    mode,
    client,
    session,
    loading,
    busy,
    notice,
    failed,
    email,
    setEmail,
    password,
    setPassword,
    preview,
    groups,
    group,
    setGroup,
    invites,
    setInvites,
    next,
    attempt,
    receipt,
    callback,
    run,
    call,
    tell,
    auth,
    loadGroups,
    loadInvites,
    ownerAction,
    recover,
    showReceipt,
    send,
    step,
    setStep,
    targeted,
    provision,
    savePassword,
    recoverPassword,
    accept,
    wrongAccount,
    signOut,
  };
}
export type OnboardingController = ReturnType<typeof useOnboarding>;
