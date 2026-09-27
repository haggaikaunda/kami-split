'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAppData } from './data-provider';
import { Button, Field, SelectField, Status } from './primitives';
import './household.css';
import type { EntryState } from '../lib/data/entry';
export function HouseholdSetup() {
  const data = useAppData();
  const router = useRouter();
  const [entry, setEntry] = useState<EntryState>();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const busy = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const lifetime = useRef(0);
  useEffect(() => {
    lifetime.current += 1;
    let current = true;
    void data.port.entry
      .read()
      .then((value) => {
        if (current) setEntry(value);
      })
      .catch(() => {
        if (current)
          setMessage(
            'Setup could not be loaded. Return to the sign-in preview and try again.',
          );
      });
    return () => {
      current = false;
      lifetime.current += 1;
    };
  }, [data.port]);
  useEffect(() => {
    if (message && !pending) field.current?.focus();
  }, [message, pending]);
  async function submit() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage('');
    const started = lifetime.current;
    const result = await data.setupHousehold(name, () => {
      if (lifetime.current === started) router.replace('/household');
    });
    if (lifetime.current === started) {
      if (result.status === 'unknown') {
        setUnknown(true);
        setMessage(
          'The setup result is unconfirmed. Check the original setup before trying again.',
        );
      } else if (result.status !== 'ok') {
        setMessage(
          result.status === 'validation'
            ? Object.values(result.fields).join(' ')
            : 'Use the first household sign-in preview before setting up a household.',
        );
        field.current?.focus();
      }
      setPending(false);
    }
    busy.current = false;
  }
  const resume =
    unknown ||
    (!!entry?.householdId && data.snapshot?.household.id !== entry.householdId);
  return (
    <section className="household-screen">
      <h1 data-page-heading tabIndex={-1}>
        Set up your household
      </h1>
      <Status kind="info">
        Simulation only. This creates an empty household for this session. No
        real account, email or persistent membership is created. Previous sample
        drafts are cleared after successful setup.
      </Status>
      {entry?.phase === 'setup-required' || resume ? (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field
            ref={field}
            label="Household name"
            value={name}
            maxLength={120}
            disabled={pending || resume}
            onChange={(event) => setName(event.target.value)}
          />
          <SelectField label="Default currency" value="USD" disabled>
            <option value="USD">USD — US dollar</option>
          </SelectField>
          <p>
            Only USD is enabled. A default currency never converts existing
            expenses.
          </p>
          {message && <Status kind="error">{message}</Status>}
          <Button
            type="submit"
            pending={pending}
            disabled={!resume && data.pendingOperations > 0}
          >
            {resume
              ? 'Check original household setup'
              : 'Create preview household'}
          </Button>
        </form>
      ) : (
        <>
          <p>
            {message ||
              (entry
                ? 'Start the first household scenario to continue, or return to your current household.'
                : 'Loading setup…')}
          </p>
          <Link href="/household">Open current household</Link>
        </>
      )}
      <Link href="/sign-in">Return to sign-in preview</Link>
    </section>
  );
}
