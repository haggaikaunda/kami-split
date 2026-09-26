'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ENTRY_SCENARIOS,
  type EntryAction,
  type EntryScenario,
  type EntryState,
} from '@/lib/data/entry';
import { useAppData } from './data-provider';
import {
  Button,
  Card,
  Field,
  SelectField,
  Skeleton,
  Status,
} from './primitives';
const labels: Record<EntryScenario, string> = {
  'existing-member': 'Existing household member',
  'first-household': 'First household setup',
  invitation: 'Valid invitation',
  'used-link': 'Already used link',
  'expired-link': 'Expired link',
  'revoked-link': 'Revoked invitation',
  'wrong-account': 'Wrong account',
  'expired-session': 'Expired session',
};
const problems: Partial<Record<EntryScenario, string>> = {
  'used-link':
    'This preview link has already been used. Request a new preview link.',
  'expired-link': 'This preview link has expired. Request a new preview link.',
  'revoked-link':
    'This invitation was revoked. Ask the household owner for another invitation. The button below rehearses receiving one; it does not contact anyone.',
  'wrong-account':
    'This invitation is for a different preview identity. Switch to the invited identity before accepting.',
  'expired-session':
    'Your preview session has expired. Request a new link to restore access and revalidate retained drafts.',
};
export function EntryPreview() {
  const data = useAppData();
  const router = useRouter();
  const [state, setState] = useState<EntryState>();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const emailField = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const next = await data.port.entry.read();
        if (active) setState(next);
      } catch {
        if (active) setError('The entry preview is unavailable. Try again.');
      }
    };
    void read();
    const unsubscribe = data.port.subscribe(() => void read());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [data.port]);
  useEffect(() => {
    heading.current?.focus();
  }, [state?.phase]);
  useEffect(() => {
    if (error && !pending) emailField.current?.focus();
  }, [error, pending]);
  async function run(action: EntryAction) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const next = await data.port.entry.dispatch(action);
      if (next.problem === 'invalid-email') {
        setError('Enter a valid email address for this preview.');
        emailField.current?.focus();
        return;
      }
      setState(next);
      setEmail('');
      await data.refresh();
      if (next.phase === 'ready') router.push('/household');
      else if (next.phase === 'setup-required') router.push('/household/setup');
    } catch {
      setError('The preview could not continue. Try again; no email was sent.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section className="entry-preview">
      <h1 ref={heading} data-page-heading tabIndex={-1}>
        Sign-in preview
      </h1>
      <Status kind="info">
        Simulation only. No email is sent, and no credentials or email address
        are saved. Use a made-up address such as alex@example.test. This is not
        production authentication.
      </Status>
      <SelectField
        label="Entry scenario"
        value={state?.scenario ?? 'existing-member'}
        disabled={pending || data.pendingOperations > 0}
        onChange={(event) =>
          void run({
            kind: 'scenario',
            scenario: event.target.value as EntryScenario,
          })
        }
      >
        {ENTRY_SCENARIOS.map((scenario) => (
          <option key={scenario} value={scenario}>
            {labels[scenario]}
          </option>
        ))}
      </SelectField>
      {data.pendingOperations > 0 && (
        <Status kind="info">
          Resolve the original financial operation before changing preview
          scenarios. You can restore the current session below.
        </Status>
      )}
      {!state ? (
        error ? (
          <Status kind="error">
            {error}
            <Button onClick={() => void run({ kind: 'new-link' })}>
              Try again
            </Button>
          </Status>
        ) : (
          <Skeleton label="Loading entry preview" />
        )
      ) : (
        <Card
          title={
            state.phase === 'sent'
              ? 'Check your preview inbox'
              : state.phase === 'invitation'
                ? 'You are invited'
                : 'Your preview session'
          }
        >
          {state.phase === 'request' && (
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void run({ kind: 'request', email });
              }}
            >
              <Field
                ref={emailField}
                label="Email address"
                type="email"
                autoComplete="off"
                value={email}
                disabled={pending}
                error={error || undefined}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Button type="submit" pending={pending}>
                Preview sign-in link
              </Button>
            </form>
          )}
          {state.phase === 'sent' && (
            <>
              <p>
                No email was sent. This button stands in for opening the
                simulated email link.
              </p>
              <Button
                pending={pending}
                onClick={() => void run({ kind: 'follow' })}
              >
                Open preview link
              </Button>
            </>
          )}
          {state.phase === 'invitation' && (
            <>
              <p>
                Alex (preview) is invited to join the sample household as a
                member. Accepting changes only this session’s simulated
                membership.
              </p>
              <div className="ui-actions">
                <Button
                  tone="secondary"
                  disabled={pending}
                  onClick={() => void run({ kind: 'decline' })}
                >
                  Decline invitation
                </Button>
                <Button
                  pending={pending}
                  onClick={() => void run({ kind: 'accept' })}
                >
                  Accept invitation
                </Button>
              </div>
            </>
          )}
          {state.phase === 'error' && (
            <>
              <Status kind="denied">{problems[state.scenario]}</Status>
              <Button
                pending={pending}
                onClick={() =>
                  void run({
                    kind:
                      state.problem === 'wrong-account'
                        ? 'switch-account'
                        : 'new-link',
                  })
                }
              >
                {state.problem === 'wrong-account'
                  ? 'Switch to invited preview identity'
                  : state.problem === 'revoked-link'
                    ? 'Preview a new owner invitation'
                    : 'Request a new preview link'}
              </Button>
            </>
          )}
          {state.phase === 'declined' && (
            <>
              <p>
                Invitation declined. You remain outside the household and cannot
                access its financial records.
              </p>
              <Button onClick={() => void run({ kind: 'new-link' })}>
                Return to sign-in preview
              </Button>
            </>
          )}
          {state.phase === 'ready' && (
            <>
              <p>
                Your simulated membership is active. Household access has been
                revalidated.
              </p>
              <Link href="/household">Open household</Link>
            </>
          )}
          {state.phase === 'setup-required' && (
            <>
              <p>Your preview requires a first household.</p>
              <Link href="/household/setup">Continue to setup preview</Link>
            </>
          )}
          {error && state.phase !== 'request' && (
            <Status kind="error">{error}</Status>
          )}
        </Card>
      )}
    </section>
  );
}
export function SetupRequired() {
  return (
    <section className="entry-preview">
      <h1 data-page-heading tabIndex={-1}>
        Household setup required
      </h1>
      <Status kind="info">
        This is a simulated first-time entry. No household has been created.
        Household naming and membership setup will be available in the next part
        of this preview.
      </Status>
      <p>No email was sent and no real account was created.</p>
      <Link href="/sign-in">Return to sign-in preview</Link>
    </section>
  );
}
