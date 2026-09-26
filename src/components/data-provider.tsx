'use client';
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
import { createMockData } from '@/lib/data/mock';
import type {
  DataPort,
  DemoControls,
  Failure,
  Snapshot,
  Household,
  Outcome,
} from '@/lib/data/port';
import { useExpenseNavigation } from './navigation/provider';

export type AppDataStatus =
  | 'loading'
  | 'refreshing'
  | 'ready'
  | 'stale'
  | 'error'
  | 'denied'
  | 'expired'
  | 'unavailable';
export type AppDataSource = { port: DataPort; demo?: DemoControls };
type QueryState = {
  snapshot?: Snapshot;
  status: AppDataStatus;
  failure?: Failure['status'] | 'unexpected';
  readyVersion: number | null;
};
export type AppData = QueryState &
  AppDataSource & {
    refresh: () => Promise<void>;
    sessionEpoch: number;
    pendingOperations: number;
    acquirePendingOperation: (id: string) => () => void;
    setupHousehold: (name: string) => Promise<Outcome<Household>>;
  };
const Context = createContext<AppData | null>(null);

/** One session-owned adapter; components depend only on the replaceable DataPort. */
export function AppDataProvider({
  children,
  source,
  householdId: initialHouseholdId = 'household-demo',
}: {
  children: ReactNode;
  source?: AppDataSource;
  householdId?: string;
}) {
  const [owned] = useState(() => createMockData());
  const port = source?.port ?? owned.port;
  const controls = source ? source.demo : owned.demo;
  const [selection, setSelection] = useState<{
    port: DataPort;
    initial: string;
    id: string;
  }>();
  const householdId =
    selection?.port === port && selection.initial === initialHouseholdId
      ? selection.id
      : initialHouseholdId;
  const { refreshVersion, drafts, discardDraft } = useExpenseNavigation();
  const sequence = useRef(0);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const locks = useRef(new Map<string, number>());
  const [pendingOperations, setPendingOperations] = useState(0);
  const acquirePendingOperation = useCallback((id: string) => {
    locks.current.set(id, (locks.current.get(id) ?? 0) + 1);
    setPendingOperations(locks.current.size);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (locks.current.get(id) ?? 1) - 1;
      if (remaining) locks.current.set(id, remaining);
      else locks.current.delete(id);
      setPendingOperations(locks.current.size);
    };
  }, []);
  const [query, setQuery] = useState<{
    port: DataPort;
    householdId: string;
    value: QueryState;
  }>({ port, householdId, value: { status: 'loading', readyVersion: null } });
  // Gate during render, before effects: a different source/household must never
  // expose even one frame of the previous access context's financial data.
  const state = useMemo<QueryState>(
    () =>
      query.port === port && query.householdId === householdId
        ? query.value
        : { status: 'loading', readyVersion: null },
    [query, port, householdId],
  );
  const invalidate = useCallback(() => {
    sequence.current += 1;
  }, []);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    const version = refreshVersion;
    setQuery((previous) => {
      const snapshot =
        previous.port === port && previous.householdId === householdId
          ? previous.value.snapshot
          : undefined;
      return {
        port,
        householdId,
        value: {
          snapshot,
          status: snapshot ? 'refreshing' : 'loading',
          readyVersion: null,
        },
      };
    });
    const setState = (
      value: QueryState | ((previous: QueryState) => QueryState),
    ) =>
      setQuery((previous) => ({
        port,
        householdId,
        value:
          typeof value === 'function'
            ? value(
                previous.port === port && previous.householdId === householdId
                  ? previous.value
                  : { status: 'loading', readyVersion: null },
              )
            : value,
      }));
    try {
      const result = await port.read(householdId);
      if (request !== sequence.current) return;
      if (result.status === 'ok')
        setState({
          snapshot: result.value,
          status: 'ready',
          readyVersion: version,
        });
      else if (result.status === 'offline')
        setState((previous) => ({
          snapshot: previous.snapshot,
          status: previous.snapshot ? 'stale' : 'error',
          failure: 'offline',
          readyVersion: version,
        }));
      else
        setState({
          status:
            result.status === 'denied' ||
            result.status === 'expired' ||
            result.status === 'unavailable'
              ? result.status
              : 'error',
          failure: result.status,
          readyVersion: version,
        });
    } catch {
      if (request === sequence.current)
        setState({
          status: 'error',
          failure: 'unexpected',
          readyVersion: version,
        });
    }
  }, [port, householdId, refreshVersion]);
  useEffect(() => {
    const unsubscribe = port.subscribe(() => {
      void refresh();
    });
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
      invalidate();
      unsubscribe();
    };
  }, [port, refresh, invalidate]);
  const clearFinancial = useCallback(() => {
    ++sequence.current;
    setQuery({
      port,
      householdId,
      value: { status: 'loading', readyVersion: null },
    });
  }, [port, householdId]);
  const setupAttempt = useRef<{
    port: DataPort;
    name: string;
    release: () => void;
  } | null>(null);
  const setupBusy = useRef(false);
  const setupScope = useRef(0);
  useEffect(() => {
    setupScope.current += 1;
    return () => {
      setupScope.current += 1;
    };
  }, [port, initialHouseholdId]);
  const setupHousehold = useCallback(
    async (name: string): Promise<Outcome<Household>> => {
      if (
        setupBusy.current ||
        (locks.current.size && !setupAttempt.current) ||
        Object.values(drafts).some((draft) => draft.pending)
      )
        return {
          status: 'validation',
          fields: {
            name: 'Resolve pending operations before creating a household.',
          },
        };
      const previous = setupAttempt.current;
      if (previous && previous.port !== port) return { status: 'unknown' };
      const attempt = previous ?? {
        port,
        name,
        release: acquirePendingOperation('household-setup'),
      };
      setupAttempt.current = attempt;
      setupBusy.current = true;
      const scope = setupScope.current;
      const currentScope = () => setupScope.current === scope;
      try {
        let result = previous ? await port.entry.read() : undefined;
        if (!currentScope()) return { status: 'unknown' };
        if (!result || result.phase === 'setup-required')
          result = await port.entry.dispatch({
            kind: 'complete-setup',
            name: attempt.name,
          });
        if (!currentScope()) return { status: 'unknown' };
        if (result.phase === 'ready' && result.householdId) {
          const read = await port.read(result.householdId);
          if (!currentScope() || read.status !== 'ok')
            return { status: 'unknown' };
          attempt.release();
          setupAttempt.current = null;
          Object.keys(drafts).forEach(discardDraft);
          clearFinancial();
          setSelection({
            port,
            initial: initialHouseholdId,
            id: result.householdId,
          });
          setSessionEpoch((epoch) => epoch + 1);
          return { status: 'ok', value: read.value.household };
        }
        if (result.problem === 'invalid-name') {
          attempt.release();
          setupAttempt.current = null;
          return {
            status: 'validation',
            fields: { name: 'Enter a household name of 1–120 characters.' },
          };
        }
        if (!previous) {
          attempt.release();
          setupAttempt.current = null;
          return { status: 'denied' };
        }
        return { status: 'unknown' };
      } catch {
        return { status: 'unknown' };
      } finally {
        setupBusy.current = false;
      }
    },
    [
      port,
      initialHouseholdId,
      acquirePendingOperation,
      drafts,
      discardDraft,
      clearFinancial,
    ],
  );
  const demo = useMemo<DemoControls | undefined>(
    () =>
      controls
        ? {
            scenario(value) {
              if (value === 'denied' || value === 'expired') clearFinancial();
              controls.scenario(value);
            },
            actor(id) {
              clearFinancial();
              controls.actor(id);
            },
            reset(fixture) {
              if (
                locks.current.size ||
                Object.values(drafts).some((draft) => draft.pending)
              )
                return;
              Object.keys(drafts).forEach(discardDraft);
              clearFinancial();
              controls.reset(fixture);
              setSelection(undefined);
              setSessionEpoch((epoch) => epoch + 1);
            },
          }
        : undefined,
    [controls, clearFinancial, drafts, discardDraft],
  );
  const value = useMemo(
    () => ({
      ...state,
      port,
      refresh,
      demo,
      sessionEpoch,
      pendingOperations,
      acquirePendingOperation,
      setupHousehold,
    }),
    [
      state,
      port,
      refresh,
      demo,
      sessionEpoch,
      pendingOperations,
      acquirePendingOperation,
      setupHousehold,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAppData(): AppData {
  const value = useContext(Context);
  if (!value) throw new Error('AppDataProvider is required');
  return value;
}
