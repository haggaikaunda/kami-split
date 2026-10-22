'use client';
import { useEffect, useRef, useState } from 'react';
import { useFinancialSession } from '../groups/session';
import { Button, Field, Status } from '../ui/primitives';
import { ContentLoading } from '../ui/loading';
import { NetworkQuery } from '@/lib/relay/query';
import type { FinancialScope } from '@/lib/relay/environment';
import query, {
  type reportingTimezoneQuery,
} from '@/lib/relay/__generated__/reportingTimezoneQuery.graphql';
import initialize, {
  type reportingTimezoneInitializeMutation,
} from '@/lib/relay/__generated__/reportingTimezoneInitializeMutation.graphql';
import update, {
  type reportingTimezoneUpdateMutation,
} from '@/lib/relay/__generated__/reportingTimezoneUpdateMutation.graphql';
import recovery, {
  type reportingTimezoneRecoveryQuery,
} from '@/lib/relay/__generated__/reportingTimezoneRecoveryQuery.graphql';
import { command, readFresh } from './relay-command';
import styles from './personal.module.css';
type Saved = { timezone: string; version: string };
type Pending = { attemptId: string; timezone: string; expectedVersion: string };
type TimezoneOutcome = reportingTimezoneQuery['response']['reportingTimezone'];
/** Only durable success or a definitive rejection resolves the frozen write.
 * Unavailable, absent and future unknown outcomes keep the original attempt. */
function definitiveTimezoneOutcome(value: TimezoneOutcome) {
  return (
    value.__typename === 'ReportingTimezone' ||
    (value.__typename === 'ReportingTimezoneProblem' &&
      [
        'INVALID_INPUT',
        'CONFLICT',
        'NOT_INITIALIZED',
        'ATTEMPT_MISMATCH',
      ].includes(value.code))
  );
}

export function ReportingTimezoneControl() {
  return <TimezoneOwner editable />;
}
export function ReportingTimezoneInitialization({
  showPeriod = false,
}: {
  showPeriod?: boolean;
}) {
  return <TimezoneOwner editable={false} showPeriod={showPeriod} />;
}
function TimezoneOwner({
  editable,
  showPeriod = false,
}: {
  editable: boolean;
  showPeriod?: boolean;
}) {
  const { scope, loading } = useFinancialSession();
  const [version, setVersion] = useState(0);
  if (loading || !scope || !scope.isLive()) return null;
  return (
    <NetworkQuery<reportingTimezoneQuery>
      key={`${scope.id}:${version}`}
      document={query}
      scope={scope}
      variables={{}}
      fallback={
        editable ? (
          <ContentLoading layout="cards" label="reporting timezone" />
        ) : null
      }
      failure={
        <Status kind="error">
          Reporting timezone is unavailable.{' '}
          <Button tone="text" onClick={() => setVersion((v) => v + 1)}>
            Retry timezone
          </Button>
        </Status>
      }
    >
      {(data) => (
        <TimezoneEditor
          key={scope.id}
          scope={scope}
          initial={data.reportingTimezone}
          editable={editable}
          showPeriod={showPeriod}
        />
      )}
    </NetworkQuery>
  );
}
function TimezoneEditor({
  scope,
  initial,
  editable,
  showPeriod,
}: {
  scope: FinancialScope;
  initial: reportingTimezoneQuery['response']['reportingTimezone'];
  editable: boolean;
  showPeriod: boolean;
}) {
  const [saved, setSaved] = useState<Saved | undefined>(
    initial.__typename === 'ReportingTimezone' ? initial : undefined,
  );
  const [zone, setZone] = useState(
    initial.__typename === 'ReportingTimezone' ? initial.timezone : '',
  );
  const initialFailure =
    initial.__typename !== 'ReportingTimezone' &&
    !(
      initial.__typename === 'ReportingTimezoneProblem' &&
      initial.code === 'NOT_INITIALIZED'
    );
  const [message, setMessage] = useState(
    initialFailure
      ? 'Your reporting timezone is unavailable. Check current access and try again.'
      : '',
  );
  const [busy, setBusy] = useState(
    initial.__typename === 'ReportingTimezoneProblem' &&
      initial.code === 'NOT_INITIALIZED',
  );
  const [blocked, setBlocked] = useState(initialFailure);
  const active = useRef(true),
    lock = useRef(false),
    pending = useRef<Pending | undefined>(undefined);
  const initialization = useRef<
    { attemptId: string; deviceTimezone: string | null } | undefined
  >(undefined);
  const live = () => active.current && scope.isLive();
  const accept = (
    value: reportingTimezoneQuery['response']['reportingTimezone'],
    preserve = false,
  ) => {
    if (!live()) return false;
    if (value.__typename !== 'ReportingTimezone') return false;
    setSaved(value);
    if (!preserve) setZone(value.timezone);
    setBlocked(false);
    return true;
  };
  const act = async (work: () => Promise<void>) => {
    if (lock.current || !live()) return;
    lock.current = true;
    setBusy(true);
    try {
      await work();
    } catch {
      if (live()) {
        setBlocked(true);
        setMessage(
          'Timezone save could not be confirmed. Check the saved timezone before saving again.',
        );
      }
    } finally {
      lock.current = false;
      if (live()) setBusy(false);
    }
  };
  const initializeZone = async () => {
    if (!initialization.current) {
      let deviceTimezone: string | null = null;
      try {
        deviceTimezone =
          Intl.DateTimeFormat().resolvedOptions().timeZone || null;
      } catch {
        /* Server uses UTC when the device has no zone. */
      }
      initialization.current = {
        attemptId: crypto.randomUUID(),
        deviceTimezone,
      };
    }
    const result = await command<reportingTimezoneInitializeMutation>(
      scope,
      initialize,
      initialization.current,
    );
    if (!accept(result.initializeReportingTimezone))
      throw new Error('UNAVAILABLE');
  };
  useEffect(() => {
    active.current = true;
    if (
      initial.__typename === 'ReportingTimezoneProblem' &&
      initial.code === 'NOT_INITIALIZED' &&
      !lock.current
    ) {
      lock.current = true;
      void initializeZone()
        .catch(() => {
          if (live()) {
            setBlocked(true);
            setMessage(
              'Timezone initialization could not be confirmed. Check the saved timezone before continuing.',
            );
          }
        })
        .finally(() => {
          lock.current = false;
          if (live()) setBusy(false);
        });
    }
    return () => {
      active.current = false;
    };
    // Initialization is keyed to the authorized owner and never follows device travel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const current = async () => {
    if (pending.current) {
      const result = await readFresh<reportingTimezoneRecoveryQuery>(
        scope,
        recovery,
        { attemptId: pending.current.attemptId, operation: 'UPDATE' },
      );
      let receipt = result.reportingTimezoneAttempt;
      if (
        receipt.__typename === 'ReportingTimezoneProblem' &&
        receipt.code === 'NOT_FOUND'
      ) {
        // Missing receipt may precede an in-flight write. Retry its identical frozen input/key.
        const replay = await command<reportingTimezoneUpdateMutation>(
          scope,
          update,
          pending.current,
        );
        receipt = replay.updateReportingTimezone;
      }
      if (!definitiveTimezoneOutcome(receipt)) throw new Error('UNAVAILABLE');
    }
    if (!saved && initialization.current) {
      await initializeZone();
      return;
    }
    const value = (await readFresh<reportingTimezoneQuery>(scope, query, {}))
      .reportingTimezone;
    if (!accept(value, true)) throw new Error('UNAVAILABLE');
    pending.current = undefined;
    setMessage(
      'Current saved timezone checked. Review your choice before saving again.',
    );
  };
  const save = async () => {
    if (!saved || blocked) return;
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone }).format();
    } catch {
      setMessage('Enter a valid IANA timezone, such as America/Los_Angeles.');
      return;
    }
    const input = {
      attemptId: crypto.randomUUID(),
      timezone: zone,
      expectedVersion: saved.version,
    };
    pending.current = input;
    const result = (
      await command<reportingTimezoneUpdateMutation>(scope, update, input)
    ).updateReportingTimezone;
    if (!live()) return;
    if (accept(result)) {
      pending.current = undefined;
      setMessage('Reporting timezone saved.');
    } else {
      setBlocked(true);
      setMessage(
        result.__typename === 'ReportingTimezoneProblem' &&
          result.code === 'CONFLICT'
          ? 'Your timezone changed elsewhere. Check the saved timezone, then review your choice.'
          : 'Timezone save could not be confirmed. Check the saved timezone before saving again.',
      );
    }
  };
  if (!editable && saved && showPeriod && !message)
    return (
      <p className={styles.muted}>
        {currentMonthLabel(saved.timezone)} · {saved.timezone}
      </p>
    );
  if (!editable)
    return message ? (
      <Status kind="error">
        {message}
        <Button tone="text" disabled={busy} onClick={() => void act(current)}>
          Check saved timezone
        </Button>
      </Status>
    ) : null;
  return (
    <section className={styles.panel} aria-labelledby="timezone-heading">
      <h2 id="timezone-heading">Reporting timezone</h2>
      <p>
        Saved once from your device and kept when you travel. Changes apply to
        reporting periods; bank calendar dates stay unchanged.
      </p>
      {saved && <p>Saved timezone: {saved.timezone}</p>}
      {message && <Status kind={blocked ? 'error' : 'info'}>{message}</Status>}
      {busy && <Status kind="pending">Checking reporting timezone…</Status>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void act(save);
        }}
      >
        <Field
          label="IANA timezone"
          value={zone}
          disabled={busy || !saved}
          onChange={(event) => setZone(event.target.value)}
          hint="For example, America/Los_Angeles or Europe/London."
        />
        <div className={styles.actions}>
          <Button
            type="submit"
            disabled={busy || !saved || blocked || zone === saved.timezone}
          >
            Save timezone
          </Button>
          {blocked && (
            <Button
              tone="secondary"
              disabled={busy}
              onClick={() => void act(current)}
            >
              Check saved timezone
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

/** Calendar periods use the saved zone; bank posted dates are never converted. */
export function currentMonthLabel(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `This month: ${format.format(new Date(Date.UTC(year, month - 1, 1)))} – ${format.format(new Date(Date.UTC(year, month - 1, last)))}`;
}
