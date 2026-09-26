/** Deterministic entry rehearsal only. No credentials, tokens, or email are retained. */
export const ENTRY_SCENARIOS = [
  'existing-member',
  'first-household',
  'invitation',
  'used-link',
  'expired-link',
  'revoked-link',
  'wrong-account',
  'expired-session',
] as const;
export type EntryScenario = (typeof ENTRY_SCENARIOS)[number];
export type EntryState = {
  scenario: EntryScenario;
  phase:
    | 'request'
    | 'sent'
    | 'invitation'
    | 'error'
    | 'declined'
    | 'ready'
    | 'setup-required';
  problem?: EntryScenario | 'invalid-email';
};
export type EntryAction =
  | { kind: 'scenario'; scenario: EntryScenario }
  | { kind: 'request'; email: string }
  | { kind: 'follow' | 'accept' | 'decline' | 'switch-account' | 'new-link' };
export interface EntryPort {
  read(): Promise<EntryState>;
  dispatch(action: EntryAction): Promise<EntryState>;
}
export function validPreviewEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
export function createEntryPreview(hooks: {
  deny(): void;
  existing(): void;
  invite(): void;
  setup(): void;
  notify(): void;
}) {
  let state: EntryState = { scenario: 'existing-member', phase: 'request' };
  const clone = () => ({ ...state });
  const port: EntryPort = {
    async read() {
      return clone();
    },
    async dispatch(action) {
      if (action.kind === 'scenario') {
        state = { scenario: action.scenario, phase: 'request' };
        hooks.deny();
      } else if (action.kind === 'request') {
        if (!validPreviewEmail(action.email))
          return { ...state, problem: 'invalid-email' };
        state = { scenario: state.scenario, phase: 'sent' };
        hooks.deny();
      } else if (action.kind === 'new-link') {
        state = {
          scenario:
            state.scenario === 'revoked-link'
              ? 'invitation'
              : 'existing-member',
          phase: 'request',
        };
        hooks.deny();
      } else if (
        action.kind === 'switch-account' &&
        state.problem === 'wrong-account'
      ) {
        state = { scenario: 'invitation', phase: 'invitation' };
        hooks.deny();
      } else if (action.kind === 'follow' && state.phase === 'sent') {
        const scenario = state.scenario;
        if (scenario === 'existing-member') {
          state = { scenario, phase: 'ready' };
          hooks.existing();
        } else if (scenario === 'first-household') {
          state = { scenario, phase: 'setup-required' };
          hooks.setup();
        } else if (scenario === 'invitation')
          state = { scenario, phase: 'invitation' };
        else state = { scenario, phase: 'error', problem: scenario };
      } else if (action.kind === 'accept' && state.phase === 'invitation') {
        // The transition happens synchronously before returning its promise.
        // Repeated clicks cannot add another member, even with different callers.
        state = { scenario: state.scenario, phase: 'ready' };
        hooks.invite();
      } else if (action.kind === 'decline' && state.phase === 'invitation') {
        state = { scenario: state.scenario, phase: 'declined' };
        hooks.deny();
      }
      hooks.notify();
      return clone();
    },
  };
  return {
    port,
    reset() {
      state = { scenario: 'existing-member', phase: 'request' };
    },
  };
}
