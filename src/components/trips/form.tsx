'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Snapshot } from '@/lib/data/port';
import { validateTripDraft, type TripDraft } from '@/lib/trips';
import { useAppData } from '../data-provider';
import { useExpenseNavigation, useSessionDraft } from '../navigation/provider';
import { useSessionCommand } from '../session-command';
import {
  Button,
  Dialog,
  ErrorSummary,
  Field,
  Skeleton,
  Status,
} from '../primitives';
import './trips.css';
const draftId = 'new-trip';
function TripFields({
  snapshot,
  disabled,
  visit,
  focus,
}: {
  snapshot: Snapshot;
  disabled: boolean;
  visit: string | null;
  focus: React.RefObject<HTMLInputElement | null>;
}) {
  const { draft, update } = useSessionDraft<TripDraft>(draftId);
  const commands = useSessionCommand();
  const { returnToSource } = useExpenseNavigation();
  const [initial] = useState<TripDraft>({
    name: '',
    destination: '',
    start: snapshot.today,
    end: snapshot.today,
  });
  const [submitted, setSubmitted] = useState(false);
  const values = draft?.values ?? initial;
  const validation = validateTripDraft(values);
  const state = draft ? commands.states[draft.operationId] : undefined;
  const errors = { ...validation.fields, ...(state?.fields ?? {}) };
  const locked = !!draft?.pending;
  useEffect(() => {
    focus.current?.focus();
  }, [focus]);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (locked || disabled || !validation.value || !draft) return;
        void commands.submit(
          draftId,
          draft.operationId,
          { kind: 'create-trip', value: validation.value },
          visit,
        );
      }}
    >
      <p>
        Give your trip a name and dates. Its expenses will remain part of your
        shared household records.
      </p>
      {disabled && (
        <Status kind="stale">
          Current household data is unavailable. Your draft is preserved;
          refresh before creating the trip.
        </Status>
      )}
      {submitted && Object.keys(errors).length > 0 && (
        <ErrorSummary
          errors={Object.entries(errors).map(([key, message]) => ({
            fieldId: `trip-${key}`,
            message,
          }))}
        />
      )}
      <fieldset disabled={locked || disabled}>
        <legend className="sr-only">Trip details</legend>
        {(['name', 'destination', 'start', 'end'] as const).map((key) => (
          <Field
            key={key}
            ref={key === 'name' ? focus : undefined}
            id={`trip-${key}`}
            label={
              {
                name: 'Trip name',
                destination: 'Destination (optional)',
                start: 'Start date',
                end: 'End date',
              }[key]
            }
            type={key === 'start' || key === 'end' ? 'date' : 'text'}
            value={values[key]}
            maxLength={
              key === 'name' ? 120 : key === 'destination' ? 200 : undefined
            }
            error={submitted ? errors[key] : undefined}
            onChange={(event) => {
              if (!locked && !disabled)
                update({ ...values, [key]: event.target.value }, 'new trip');
            }}
          />
        ))}
      </fieldset>
      {state && state.phase !== 'saved' && (
        <Status kind={state.phase === 'failed' ? 'error' : 'pending'}>
          {state.message}
          {state.phase === 'unknown' && draft && (
            <Button onClick={() => void commands.recover(draft.operationId)}>
              Check trip status and retry safely
            </Button>
          )}
        </Status>
      )}
      <div className="ui-actions">
        <Button tone="secondary" onClick={() => returnToSource(visit)}>
          {draft ? 'Leave and preserve draft' : 'Cancel'}
        </Button>
        <Button
          type="submit"
          pending={state?.phase === 'submitting'}
          disabled={locked || disabled}
        >
          Create trip
        </Button>
      </div>
    </form>
  );
}
export function CreateTrip() {
  const { snapshot, status, refresh } = useAppData();
  const { returnToSource } = useExpenseNavigation();
  const visit = useSearchParams().get('visit');
  const focus = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open
      title="Create trip"
      onClose={() => returnToSource(visit)}
      initialFocusRef={focus}
    >
      <div className="trip-form">
        {snapshot && ['ready', 'refreshing', 'stale'].includes(status) ? (
          <TripFields
            snapshot={snapshot}
            disabled={status !== 'ready'}
            visit={visit}
            focus={focus}
          />
        ) : status === 'loading' ? (
          <Skeleton label="Loading trip form" />
        ) : (
          <Status kind="denied">
            This household is unavailable. Your draft is retained and its fields
            are hidden.<Button onClick={() => void refresh()}>Try again</Button>
          </Status>
        )}
      </div>
    </Dialog>
  );
}
