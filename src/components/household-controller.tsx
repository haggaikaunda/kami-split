'use client';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  Command,
  DataPort,
  Envelope,
  Outcome,
  Entity,
} from '../lib/data/port';
import { useAppData } from './data-provider';
import { Button, Status } from './primitives';
type Attempt = {
  envelope: Envelope;
  actorId: string;
  port: DataPort;
  epoch: number;
  release: () => void;
};
type State = {
  phase: 'idle' | 'pending' | 'unknown' | 'done' | 'failed';
  message: string;
};
const Context = createContext<{
  state: State;
  submit(command: Command): Promise<void>;
  recover(): Promise<void>;
} | null>(null);
export function HouseholdCommandsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { sessionEpoch } = useAppData();
  return <Session key={sessionEpoch}>{children}</Session>;
}
function Session({ children }: { children: ReactNode }) {
  const data = useAppData();
  const access = useRef(data);
  useEffect(() => {
    access.current = data;
  }, [data]);
  const attempt = useRef<Attempt | null>(null);
  const busy = useRef(false);
  const [state, setState] = useState<State>({ phase: 'idle', message: '' });
  const same = (row: Attempt) => {
    const current = access.current;
    return (
      current.port === row.port &&
      current.sessionEpoch === row.epoch &&
      current.status === 'ready' &&
      current.snapshot?.actorId === row.actorId &&
      current.snapshot.household.id === row.envelope.householdId
    );
  };
  async function run(row: Attempt, recovery: boolean) {
    if (busy.current) return;
    const receiptOnly =
      recovery &&
      row.envelope.command.kind === 'remove-member' &&
      row.envelope.command.memberId === row.actorId &&
      access.current.port === row.port &&
      access.current.sessionEpoch === row.epoch;
    if (!same(row) && !receiptOnly) {
      setState({
        phase: 'unknown',
        message:
          'Return to the original session before checking this household change.',
      });
      return;
    }
    busy.current = true;
    setState({
      phase: 'pending',
      message: recovery
        ? 'Checking the original household change…'
        : 'Saving household change…',
    });
    try {
      let result: Outcome<Entity>;
      if (recovery) {
        const lookup = await row.port.operation(
          row.envelope.householdId,
          row.envelope.operationId,
        );
        if (
          !same(row) &&
          !(
            receiptOnly &&
            lookup.status === 'ok' &&
            lookup.value.id === row.actorId &&
            'status' in lookup.value &&
            lookup.value.status === 'inactive'
          )
        ) {
          setState({
            phase: 'unknown',
            message: 'Return to the original session to check this change.',
          });
          return;
        }
        if (lookup.status === 'not-started') {
          const check = await row.port.read(row.envelope.householdId);
          if (
            !same(row) ||
            check.status !== 'ok' ||
            check.value.actorId !== row.actorId
          ) {
            setState({
              phase: 'unknown',
              message: 'The original session could not be verified.',
            });
            return;
          }
          result = await row.port.execute(row.envelope);
        } else if (lookup.status === 'ok') result = lookup;
        else {
          setState({
            phase: 'unknown',
            message:
              'The change is still unconfirmed. Restore the original session and check again.',
          });
          return;
        }
      } else result = await row.port.execute(row.envelope);
      if (result.status === 'unknown')
        setState({
          phase: 'unknown',
          message:
            'The change may have completed. Check its original operation before retrying.',
        });
      else {
        row.release();
        attempt.current = null;
        setState({
          phase: result.status === 'ok' ? 'done' : 'failed',
          message:
            result.status === 'ok'
              ? 'Household change saved. No email was sent.'
              : result.status === 'validation'
                ? Object.values(result.fields).join(' ')
                : result.status === 'denied'
                  ? 'This action is not allowed for the current role or session.'
                  : 'The change was not saved. Restore connection and try again.',
        });
        await access.current.refresh();
      }
    } catch {
      setState({
        phase: 'unknown',
        message:
          'The change result is unknown. Check the original operation before retrying.',
      });
    } finally {
      busy.current = false;
    }
  }
  async function submit(command: Command) {
    const current = access.current;
    if (
      attempt.current ||
      busy.current ||
      current.status !== 'ready' ||
      !current.snapshot
    )
      return;
    const operationId = crypto.randomUUID();
    const row: Attempt = {
      envelope: {
        householdId: current.snapshot.household.id,
        operationId,
        command: structuredClone(command),
      },
      actorId: current.snapshot.actorId,
      port: current.port,
      epoch: current.sessionEpoch,
      release: current.acquirePendingOperation(operationId),
    };
    attempt.current = row;
    await run(row, false);
  }
  const recover = async () => {
    if (attempt.current) await run(attempt.current, true);
  };
  return (
    <Context.Provider value={{ state, submit, recover }}>
      {state.phase !== 'idle' && (
        <Status
          kind={
            state.phase === 'failed'
              ? 'error'
              : state.phase === 'done'
                ? 'success'
                : 'pending'
          }
        >
          {state.message}
          {state.phase === 'unknown' && (
            <Button onClick={() => void recover()}>
              Check household change
            </Button>
          )}
        </Status>
      )}
      {children}
    </Context.Provider>
  );
}
export function useHouseholdCommands() {
  const value = useContext(Context);
  if (!value) throw new Error('HouseholdCommandsProvider required');
  return value;
}
