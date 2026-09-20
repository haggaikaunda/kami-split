'use client';
import Link from 'next/link';
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
  ExpenseInput,
  Outcome,
  Entity,
  DataPort,
} from '../../lib/data/port';
import { useAppData } from '../data-provider';
import { useExpenseNavigation } from '../navigation/provider';
import { Button, Status } from '../primitives';

type Attempt = {
  envelope: Envelope;
  actorId: string;
  port: DataPort;
  draftId: string;
  visit: string | null;
  href: string;
  entry: unknown;
};
export type CreationState = {
  phase: 'submitting' | 'unknown' | 'failed' | 'saved';
  message: string;
  fields?: Record<string, string>;
};
type CreationContext = {
  states: Readonly<Record<string, CreationState>>;
  submit: (
    draftId: string,
    operationId: string,
    value: ExpenseInput,
    visit: string | null,
  ) => Promise<void>;
  recover: (operationId: string) => Promise<void>;
};
const Context = createContext<CreationContext | null>(null);
/** Lives above routes: a request completes even when its initiating form unmounts. */
export function ExpenseCreationProvider({ children }: { children: ReactNode }) {
  const { port, snapshot, status, refresh } = useAppData();
  const access = useRef({ port, snapshot, status });
  useEffect(() => {
    access.current = { port, snapshot, status };
  }, [port, snapshot, status]);
  const { setDraftPending, discardDraft, returnToSource } =
    useExpenseNavigation();
  const attempts = useRef(new Map<string, Attempt>());
  const busy = useRef(new Set<string>());
  const [states, setStates] = useState<Record<string, CreationState>>({});
  const [savedId, setSavedId] = useState<string | null>(null);
  const state = useCallback(
    (id: string, value: CreationState) =>
      setStates((previous) => ({ ...previous, [id]: value })),
    [],
  );
  const sameSession = useCallback((attempt: Attempt) => {
    const current = access.current;
    return (
      current.port === attempt.port &&
      current.status === 'ready' &&
      current.snapshot?.actorId === attempt.actorId &&
      current.snapshot.household.id === attempt.envelope.householdId
    );
  }, []);
  const run = useCallback(
    async (attempt: Attempt, recovery: boolean) => {
      const id = attempt.envelope.operationId;
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
      setDraftPending(attempt.draftId, true);
      state(id, {
        phase: 'submitting',
        message: recovery
          ? 'Checking this operation before retrying…'
          : 'Saving expense…',
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
          state(id, { phase: 'saved', message: 'Expense saved.' });
          setDraftPending(attempt.draftId, false);
          discardDraft(attempt.draftId);
          setSavedId(result.value.id);
          await refresh();
          // Do not pull users back after they navigated while a request was running.
          if (
            window.location.pathname + window.location.search ===
              attempt.href &&
            window.history.state?.kamiEntry === attempt.entry
          )
            returnToSource(attempt.visit);
        } else if (result.status === 'unknown') {
          state(id, {
            phase: 'unknown',
            message:
              'The save may have completed. Keep this draft unchanged and check the operation before trying again.',
          });
        } else {
          setDraftPending(attempt.draftId, false);
          state(id, {
            phase: 'failed',
            fields: result.status === 'validation' ? result.fields : undefined,
            message:
              result.status === 'offline'
                ? 'No expense was saved. Restore your connection and retry.'
                : result.status === 'denied' || result.status === 'expired'
                  ? 'Access could not be confirmed. Your draft is preserved; restore your session before retrying.'
                  : result.status === 'operation-conflict'
                    ? 'This operation already belongs to different values. Check the saved operation before continuing.'
                    : 'The expense was not saved. Check your fields and retry.',
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
      refresh,
      setDraftPending,
      discardDraft,
      returnToSource,
      state,
    ],
  );
  const submit = useCallback(
    async (
      draftId: string,
      operationId: string,
      value: ExpenseInput,
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
          command: { kind: 'create-expense', value: structuredClone(value) },
        },
        actorId: current.snapshot.actorId,
        port: current.port,
        draftId,
        visit,
        href: window.location.pathname + window.location.search,
        entry: window.history.state?.kamiEntry,
      };
      attempts.current.set(operationId, attempt);
      await run(attempt, false);
    },
    [run, states],
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
            Expense saved. Your source filters are preserved.{' '}
            <Link href={`/expenses/${encodeURIComponent(savedId)}`}>
              View expense
            </Link>
            <Button tone="secondary" onClick={() => setSavedId(null)}>
              Dismiss
            </Button>
          </Status>
        </div>
      )}
      {children}
    </Context.Provider>
  );
}
export function useExpenseCreation() {
  const value = useContext(Context);
  if (!value) throw new Error('ExpenseCreationProvider is required');
  return value;
}
