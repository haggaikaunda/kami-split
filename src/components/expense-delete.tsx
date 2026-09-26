'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { DataPort, Envelope, ExpenseRecord } from '../lib/data/port';
import { formatMoney } from '../lib/ledger';
import { useAppData } from './data-provider';
import { Button, Dialog, Field, Status } from './primitives';

type Deletion = {
  record: ExpenseRecord;
  reason: string;
  actorId: string;
  householdId: string;
  port: DataPort;
  operationId: string;
  epoch: number;
  release?: () => void;
  phase: 'editing' | 'pending' | 'unknown' | 'conflict' | 'failed' | 'done';
  message?: string;
  envelope?: Envelope;
};
const Context = createContext<((record: ExpenseRecord) => void) | null>(null);
/** Session-owned confirmations survive detail unmounts and never navigate on completion. */
export function ExpenseDeletionProvider({ children }: { children: ReactNode }) {
  const data = useAppData();
  const pathname = usePathname();
  const search = useSearchParams();
  const href = pathname + '?' + search.toString();
  const [origin, setOrigin] = useState('');
  const access = useRef(data);
  useEffect(() => {
    access.current = data;
  }, [data]);
  const attempts = useRef(new Map<string, Deletion>());
  const busy = useRef(new Set<string>());
  const [active, setActive] = useState<string | null>(null);
  const [rows, setRows] = useState(new Map<string, Deletion>());
  const safe = useRef<HTMLButtonElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const update = (id: string, patch: Partial<Deletion>) => {
    const previous = attempts.current.get(id);
    if (previous) attempts.current.set(id, { ...previous, ...patch });
    setRows(new Map(attempts.current));
  };
  const same = (attempt: Deletion) => {
    const current = access.current;
    return (
      current.port === attempt.port &&
      current.status === 'ready' &&
      current.sessionEpoch === attempt.epoch &&
      current.snapshot?.actorId === attempt.actorId &&
      current.snapshot.household.id === attempt.householdId
    );
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        [...attempts.current.values()].some(
          (row) =>
            row.epoch === access.current.sessionEpoch &&
            row.phase !== 'done' &&
            (row.reason || row.phase === 'pending' || row.phase === 'unknown'),
        )
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const open = (record: ExpenseRecord) => {
    const { snapshot, status, port } = access.current;
    if (!snapshot || status !== 'ready' || record.deleted) return;
    trigger.current = document.activeElement as HTMLElement;
    const key = `${snapshot.household.id}:${snapshot.actorId}:${access.current.sessionEpoch}:${record.id}`;
    const old = attempts.current.get(key);
    if (!old || old.port !== port)
      attempts.current.set(key, {
        record: structuredClone(record),
        reason: '',
        actorId: snapshot.actorId,
        householdId: snapshot.household.id,
        port,
        epoch: access.current.sessionEpoch,
        operationId: crypto.randomUUID(),
        phase: 'editing',
      });
    setOrigin(href);
    setActive(key);
    setRows(new Map(attempts.current));
  };
  const run = async (id: string, recovery: boolean) => {
    const attempt = attempts.current.get(id);
    if (
      !attempt ||
      busy.current.has(id) ||
      !same(attempt) ||
      attempt.phase === 'done'
    )
      return;
    if (
      !recovery &&
      (attempt.phase === 'unknown' || attempt.phase === 'conflict')
    )
      return;
    const envelope: Envelope = attempt.envelope ?? {
      householdId: attempt.householdId,
      operationId: attempt.operationId,
      command: {
        kind: 'delete-expense',
        id: attempt.record.id,
        expectedVersion: attempt.record.version,
        reason: attempt.reason,
      },
    };
    const release =
      attempt.release ?? data.acquirePendingOperation(attempt.operationId);
    update(id, { release });
    busy.current.add(id);
    update(id, {
      phase: 'pending',
      envelope,
      message: recovery
        ? 'Checking the original deletion…'
        : 'Deleting expense…',
    });
    try {
      let result;
      if (recovery) {
        const lookup = await attempt.port.operation(
          attempt.householdId,
          attempt.operationId,
        );
        if (!same(attempt)) {
          update(id, {
            phase: 'unknown',
            message:
              'Return to the original session before checking this deletion.',
          });
          return;
        }
        if (lookup.status === 'not-started') {
          const verified = await attempt.port.read(attempt.householdId);
          if (
            !same(attempt) ||
            verified.status !== 'ok' ||
            verified.value.actorId !== attempt.actorId
          ) {
            update(id, {
              phase: 'unknown',
              message:
                'The original session could not be verified. No retry was sent.',
            });
            return;
          }
          result = await attempt.port.execute(envelope);
        } else if (lookup.status === 'ok') result = lookup;
        else {
          update(id, {
            phase: 'unknown',
            message:
              'The deletion is still unconfirmed. Restore access and check again.',
          });
          return;
        }
      } else result = await attempt.port.execute(envelope);
      if (result.status === 'ok' || result.status === 'deleted') {
        release();
        update(id, { release: undefined });
        update(id, {
          phase: 'done',
          message:
            result.status === 'deleted'
              ? 'This expense was already deleted by another change. Its history is retained.'
              : 'Expense deleted. Its history is retained.',
        });
        await access.current.refresh();
      } else if (result.status === 'conflict') {
        release();
        update(id, { release: undefined });
        update(id, {
          phase: 'conflict',
          message:
            'This expense changed. Review the latest amount and revision before confirming deletion again.',
        });
        await access.current.refresh();
      } else if (result.status === 'unknown') {
        update(id, {
          phase: 'unknown',
          message:
            'Deletion may have completed. Check the original operation before retrying; your reason is retained.',
        });
      } else {
        release();
        update(id, { release: undefined });
        update(id, {
          phase: 'failed',
          envelope: undefined,
          message:
            result.status === 'offline'
              ? 'No deletion was made. Restore connection and retry.'
              : result.status === 'validation'
                ? Object.values(result.fields).join(' ')
                : 'Deletion was not completed. Restore access and retry. Your reason is retained.',
        });
      }
    } catch {
      update(id, {
        phase: 'unknown',
        message:
          'The result is unknown. Check the original operation before retrying.',
      });
    } finally {
      busy.current.delete(id);
    }
  };
  const selected = active ? rows.get(active) : undefined;
  const canSee = (row: Deletion) =>
    data.port === row.port &&
    data.sessionEpoch === row.epoch &&
    ['ready', 'refreshing', 'stale'].includes(data.status) &&
    data.snapshot?.actorId === row.actorId &&
    data.snapshot?.household.id === row.householdId;
  const visible = selected && canSee(selected) && origin === href;
  useEffect(() => {
    if (!visible) return;
    // Completion removes the focused submit button; retain a useful keyboard
    // destination inside this dialog instead of leaving focus on the document.
    if (selected?.phase === 'done') safe.current?.focus();
    else if (
      data.status === 'ready' &&
      (selected?.phase === 'conflict' || selected?.phase === 'unknown')
    )
      actions.current
        ?.querySelector<HTMLButtonElement>('[data-next-action]')
        ?.focus();
  }, [visible, selected?.phase, data.status]);
  const close = () => {
    const removedTrigger = selected?.phase === 'done';
    setActive(null);
    if (removedTrigger)
      window.setTimeout(
        () =>
          document
            .getElementById('expense-heading')
            ?.focus({ preventScroll: true }),
        0,
      );
  };
  const locked = selected?.phase === 'pending' || selected?.phase === 'unknown';
  return (
    <Context.Provider value={open}>
      {children}
      {[...rows.entries()]
        .filter(
          ([id, row]) =>
            (id !== active || origin !== href) &&
            canSee(row) &&
            (row.phase === 'pending' || row.phase === 'unknown'),
        )
        .map(([id]) => (
          <Status key={id} kind="info">
            A deletion is awaiting confirmation.{' '}
            <Button
              tone="secondary"
              onClick={() => {
                setOrigin(href);
                setActive(id);
              }}
            >
              Check deletion
            </Button>
          </Status>
        ))}
      <Dialog
        open={!!visible}
        title={
          selected?.phase === 'done' ? 'Expense deleted' : 'Delete expense?'
        }
        onClose={close}
        initialFocusRef={safe}
        returnFocusRef={trigger}
      >
        {visible && selected && (
          <>
            <p>
              <strong>{selected.record.description}</strong> · $
              {formatMoney(selected.record.amount, selected.record.currency)}
            </p>
            <p>
              Deletion removes this expense from balances, contributions,
              spending charts and trip totals. The record and its revision
              history remain available.
            </p>
            {selected.message && (
              <Status kind={selected.phase === 'done' ? 'success' : 'info'}>
                {selected.message}
              </Status>
            )}
            {selected.phase !== 'done' && (
              <Field
                label="Reason (optional)"
                value={selected.reason}
                disabled={locked}
                maxLength={500}
                onChange={(event) =>
                  update(active!, {
                    reason: event.target.value,
                    envelope: undefined,
                  })
                }
              />
            )}
            <div className="ui-actions" ref={actions}>
              <button
                ref={safe}
                type="button"
                className="ui-button ui-button--secondary"
                onClick={close}
              >
                {selected.phase === 'done'
                  ? 'View retained expense'
                  : locked
                    ? 'Close and keep checking later'
                    : 'Keep expense'}
              </button>
              {selected.phase === 'conflict' ? (
                <Button
                  data-next-action
                  disabled={data.status !== 'ready'}
                  onClick={() => {
                    const latest = data.snapshot?.expenses.find(
                      (row) => row.id === selected.record.id,
                    );
                    if (latest?.deleted)
                      update(active!, {
                        phase: 'done',
                        message:
                          'This expense is already deleted. Its history is retained.',
                      });
                    else if (latest)
                      update(active!, {
                        record: structuredClone(latest),
                        envelope: undefined,
                        epoch: access.current.sessionEpoch,
                        operationId: crypto.randomUUID(),
                        phase: 'editing',
                        message:
                          'Latest revision loaded. Review its name and amount before deleting.',
                      });
                  }}
                >
                  Review latest revision
                </Button>
              ) : selected.phase === 'unknown' ? (
                <Button
                  data-next-action
                  disabled={data.status !== 'ready'}
                  onClick={() => void run(active!, true)}
                >
                  Check deletion status
                </Button>
              ) : (
                selected.phase !== 'done' && (
                  <Button
                    tone="danger"
                    pending={selected.phase === 'pending'}
                    disabled={data.status !== 'ready'}
                    onClick={() => void run(active!, false)}
                  >
                    Delete expense
                  </Button>
                )
              )}
            </div>
          </>
        )}
      </Dialog>
    </Context.Provider>
  );
}
export function DeleteExpenseButton({ record }: { record: ExpenseRecord }) {
  const open = useContext(Context);
  if (!open || record.deleted) return null;
  return (
    <Button tone="danger" onClick={() => open(record)}>
      Delete expense
    </Button>
  );
}
