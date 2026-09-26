'use client';
import Link from 'next/link';
import { ExpenseLink, RepaymentLink } from './navigation/links';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  Envelope,
  Command,
  Failure,
  Outcome,
  Entity,
  DataPort,
} from '../lib/data/port';
import { useAppData } from './data-provider';
import { useExpenseNavigation } from './navigation/provider';
import { Button, Status } from './primitives';

type Attempt = {
  envelope: Envelope;
  actorId: string;
  port: DataPort;
  draftId: string;
  visit: string | null;
  href: string;
  entry: unknown;
  epoch: number;
};
export type CommandState = {
  phase: 'submitting' | 'unknown' | 'failed' | 'saved';
  message: string;
  fields?: Record<string, string>;
  result?: Failure;
};
type CommandContext = {
  states: Readonly<Record<string, CommandState>>;
  submit: (
    draftId: string,
    operationId: string,
    command: Command,
    visit: string | null,
  ) => Promise<void>;
  recover: (operationId: string) => Promise<void>;
};
const Context = createContext<CommandContext | null>(null);
/** Lives above routes: a request completes even when its initiating form unmounts. */
export function SessionCommandProvider({ children }: { children: ReactNode }) {
  const { sessionEpoch } = useAppData();
  return <CommandSession key={sessionEpoch}>{children}</CommandSession>;
}
function CommandSession({ children }: { children: ReactNode }) {
  const {
    port,
    snapshot,
    status,
    refresh,
    sessionEpoch,
    acquirePendingOperation,
  } = useAppData();
  const access = useRef({ port, snapshot, status, sessionEpoch });
  useEffect(() => {
    access.current = { port, snapshot, status, sessionEpoch };
  }, [port, snapshot, status, sessionEpoch]);
  const { setDraftPending, discardDraft, returnToSource, replaceDestination } =
    useExpenseNavigation();
  const attempts = useRef(new Map<string, Attempt>());
  const busy = useRef(new Set<string>());
  const leases = useRef(new Map<string, () => void>());
  const [states, setStates] = useState<Record<string, CommandState>>({});
  const [saved, setSaved] = useState<{
    id: string;
    kind: Command['kind'];
    epoch: number;
    actorId: string;
    householdId: string;
  } | null>(null);
  const savedId =
    saved &&
    saved.epoch === sessionEpoch &&
    saved.actorId === snapshot?.actorId &&
    saved.householdId === snapshot.household.id &&
    status === 'ready'
      ? saved.id
      : null;
  const state = useCallback(
    (id: string, value: CommandState) =>
      setStates((previous) => ({ ...previous, [id]: value })),
    [],
  );
  const sameSession = useCallback((attempt: Attempt) => {
    const current = access.current;
    return (
      current.sessionEpoch === attempt.epoch &&
      current.port === attempt.port &&
      current.status === 'ready' &&
      current.snapshot?.actorId === attempt.actorId &&
      current.snapshot.household.id === attempt.envelope.householdId
    );
  }, []);
  const run = useCallback(
    async (attempt: Attempt, recovery: boolean) => {
      const id = attempt.envelope.operationId;
      const noun =
        attempt.envelope.command.kind === 'record-repayment'
          ? 'repayment'
          : attempt.envelope.command.kind === 'create-trip'
            ? 'trip'
            : 'expense';
      if (busy.current.has(id)) return;
      if (recovery && !sameSession(attempt)) {
        state(id, {
          phase: 'unknown',
          message:
            'Return to the session that started this save before checking or retrying it. The original operation is retained.',
        });
        return;
      }
      busy.current.add(id);
      if (!leases.current.has(id))
        leases.current.set(id, acquirePendingOperation(id));
      setDraftPending(attempt.draftId, true);
      state(id, {
        phase: 'submitting',
        message: recovery
          ? 'Checking this operation before retrying…'
          : 'Saving record…',
      });
      try {
        let result: Outcome<Entity>;
        if (recovery) {
          const lookup = await attempt.port.operation(
            attempt.envelope.householdId,
            id,
          );
          if (!sameSession(attempt)) {
            state(id, {
              phase: 'unknown',
              message:
                'The session changed while checking this save. Return to the original session before retrying.',
            });
            return;
          }
          if (lookup.status === 'not-started') {
            const current = await attempt.port.read(
              attempt.envelope.householdId,
            );
            if (
              !sameSession(attempt) ||
              current.status !== 'ok' ||
              current.value.actorId !== attempt.actorId
            ) {
              state(id, {
                phase: 'unknown',
                message:
                  'The original session could not be verified. Your operation is retained without another write.',
              });
              return;
            }
            result = await attempt.port.execute(attempt.envelope);
          } else if (lookup.status === 'ok') result = lookup;
          else {
            state(id, {
              phase: 'unknown',
              message:
                'The result is still unconfirmed. Your unchanged draft and operation are retained. Restore access or connection, then check again.',
            });
            return;
          }
        } else result = await attempt.port.execute(attempt.envelope);
        if (result.status === 'ok') {
          state(id, {
            phase: 'saved',
            message:
              attempt.envelope.command.kind === 'record-repayment'
                ? 'Repayment recorded.'
                : attempt.envelope.command.kind === 'create-trip'
                  ? 'Trip created.'
                  : 'Expense saved.',
          });
          leases.current.get(id)?.();
          leases.current.delete(id);
          setDraftPending(attempt.draftId, false);
          discardDraft(attempt.draftId);
          setSaved({
            id: result.value.id,
            kind: attempt.envelope.command.kind,
            epoch: attempt.epoch,
            actorId: attempt.actorId,
            householdId: attempt.envelope.householdId,
          });
          await refresh();
          // Do not pull users back after they navigated while a request was running.
          if (
            access.current.port === attempt.port &&
            access.current.snapshot?.actorId === attempt.actorId &&
            access.current.sessionEpoch === attempt.epoch &&
            window.location.pathname + window.location.search ===
              attempt.href &&
            window.history.state?.kamiEntry === attempt.entry
          )
            if (attempt.envelope.command.kind === 'create-trip')
              replaceDestination(
                `/trips/${encodeURIComponent(result.value.id)}${attempt.visit ? `?visit=${encodeURIComponent(attempt.visit)}` : ''}`,
              );
            else if (attempt.envelope.command.kind === 'update-expense')
              returnToSource(
                attempt.visit,
                `/expenses/${encodeURIComponent(attempt.envelope.command.id)}`,
              );
            else returnToSource(attempt.visit);
        } else if (result.status === 'unknown') {
          state(id, {
            phase: 'unknown',
            message:
              'The save may have completed. Keep this draft unchanged and check the operation before trying again.',
          });
        } else {
          leases.current.get(id)?.();
          leases.current.delete(id);
          setDraftPending(attempt.draftId, false);
          state(id, {
            phase: 'failed',
            fields: result.status === 'validation' ? result.fields : undefined,
            result,
            message:
              result.status === 'offline'
                ? `No ${noun} was saved. Restore your connection and retry.`
                : result.status === 'denied' || result.status === 'expired'
                  ? 'Access could not be confirmed. Your draft is preserved; restore your session before retrying.'
                  : result.status === 'operation-conflict'
                    ? 'This operation already belongs to different values. Check the saved operation before continuing.'
                    : `The ${noun} was not saved. Check your fields and retry.`,
          });
        }
      } catch {
        // A rejected transport promise cannot prove that a write did not commit.
        state(id, {
          phase: 'unknown',
          message:
            'The save result is unknown. Your unchanged draft and operation are retained; check its status before retrying.',
        });
      } finally {
        busy.current.delete(id);
      }
    },
    [
      sameSession,
      acquirePendingOperation,
      refresh,
      setDraftPending,
      discardDraft,
      returnToSource,
      replaceDestination,
      state,
    ],
  );
  const submit = useCallback(
    async (
      draftId: string,
      operationId: string,
      command: Command,
      visit: string | null,
    ) => {
      const current = access.current;
      if (
        !current.snapshot ||
        current.status !== 'ready' ||
        busy.current.has(operationId) ||
        states[operationId]?.phase === 'saved' ||
        states[operationId]?.phase === 'unknown'
      )
        return;
      const attempt: Attempt = {
        envelope: {
          householdId: current.snapshot.household.id,
          operationId,
          command: structuredClone(command),
        },
        actorId: current.snapshot.actorId,
        port: current.port,
        draftId,
        visit,
        href: window.location.pathname + window.location.search,
        entry: window.history.state?.kamiEntry,
        epoch: sessionEpoch,
      };
      attempts.current.set(operationId, attempt);
      await run(attempt, false);
    },
    [run, states, sessionEpoch],
  );
  const recover = useCallback(
    async (id: string) => {
      const attempt = attempts.current.get(id);
      if (attempt) {
        // The command identity stays frozen, but an explicit recovery may be
        // initiated from a newly resumed visit to this same session draft.
        const activeDraft =
          window.location.pathname ===
          `/drafts/${encodeURIComponent(attempt.draftId)}`;
        const returning = activeDraft
          ? {
              ...attempt,
              href: window.location.pathname + window.location.search,
              entry: window.history.state?.kamiEntry,
              visit: new URLSearchParams(window.location.search).get('visit'),
            }
          : attempt;
        await run(returning, true);
      }
    },
    [run],
  );
  const value = useMemo(
    () => ({ states, submit, recover }),
    [states, submit, recover],
  );
  return (
    <Context.Provider value={value}>
      {savedId && (
        <div className="expense-save-notice">
          <Status kind="success">
            {saved?.kind === 'record-repayment'
              ? 'Repayment recorded.'
              : saved?.kind === 'create-trip'
                ? 'Trip created.'
                : saved?.kind === 'update-expense'
                  ? 'Expense updated.'
                  : 'Expense saved.'}{' '}
            Your source filters are preserved.{' '}
            {saved?.kind === 'record-repayment' ? (
              <RepaymentLink
                repaymentId={savedId}
                id={`saved-repayment-${savedId}`}
              >
                View repayment
              </RepaymentLink>
            ) : saved?.kind === 'create-trip' ? (
              <Link href={`/trips/${encodeURIComponent(savedId)}`}>
                View trip
              </Link>
            ) : (
              <ExpenseLink expenseId={savedId} id={`saved-expense-${savedId}`}>
                View expense
              </ExpenseLink>
            )}
            <Button tone="secondary" onClick={() => setSaved(null)}>
              Dismiss
            </Button>
          </Status>
        </div>
      )}
      {children}
    </Context.Provider>
  );
}
export function useSessionCommand() {
  const value = useContext(Context);
  if (!value) throw new Error('SessionCommandProvider is required');
  return value;
}
