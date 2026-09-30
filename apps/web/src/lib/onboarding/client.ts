import {
  createClient,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';

/** Cancels private requests on unmount or identity change; late results are ignored. */
export class RequestEpoch {
  private generation = 0;
  private controllers = new Set<AbortController>();
  reset() {
    this.generation++;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
  async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const generation = this.generation;
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      const result = await work(controller.signal);
      if (generation !== this.generation) throw new Error('SESSION_CHANGED');
      return result;
    } finally {
      this.controllers.delete(controller);
    }
  }
}

export type Attempt = {
  kind: 'CREATE' | 'RESEND' | 'REVOKE' | 'ACCEPT';
  key: string;
  groupID?: string;
  invitationID?: string;
  tokenDigest?: string;
};
const storageKey = 'kami-onboarding-attempt';
export function readAttempt(): Attempt | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(storageKey) ?? 'null',
    ) as Attempt | null;
    return value &&
      ['CREATE', 'RESEND', 'REVOKE', 'ACCEPT'].includes(value.kind) &&
      /^[0-9a-f-]{36}$/.test(value.key)
      ? value
      : null;
  } catch {
    return null;
  }
}
export function saveAttempt(value: Attempt | null) {
  if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
  else sessionStorage.removeItem(storageKey);
}
export async function jsonRequest(
  path: string,
  input: unknown,
  session: Session | null,
  signal: AbortSignal,
) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(input),
    signal,
    cache: 'no-store',
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      value.code ?? value.errors?.[0]?.extensions?.code ?? 'UNAVAILABLE',
    );
  return value;
}
let browserClient: Promise<SupabaseClient> | undefined;
export function loadClient(): Promise<SupabaseClient> {
  browserClient ??= initializeClient().catch((error) => {
    browserClient = undefined;
    throw error;
  });
  return browserClient;
}
async function initializeClient(): Promise<SupabaseClient> {
  const response = await fetch('/api/onboarding-config', { cache: 'no-store' });
  if (!response.ok) throw new Error('UNAVAILABLE');
  const { url, key } = await response.json();
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'kami-auth',
    },
  });
}
export const actionFields =
  '__typename ... on InvitationActionResult { actionID invitationID groupID outcome committedExpiresAt currentExpiresAt lifecycle delivery hasAccess } ... on InvitationProblem { code message }';
export const recoveryQuery = `query($kind:InvitationOperation!,$key:OperationKey!){ invitationAction(kind:$kind,key:$key){${actionFields}} }`;
