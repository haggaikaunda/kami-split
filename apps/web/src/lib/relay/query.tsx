'use client';
import {
  Component,
  Suspense,
  useEffect,
  useState,
  useEffectEvent,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  usePreloadedQuery,
  loadQuery,
  useRelayEnvironment,
  type PreloadedQuery,
} from 'react-relay';
import {
  createOperationDescriptor,
  getRequest,
  type Environment,
  type Variables,
  type GraphQLTaggedNode,
  type OperationType,
} from 'relay-runtime';
import type { FinancialScope } from './environment';

type ReadState = { busy: boolean; error: boolean };
/** A mounted read with explicit bounded-reuse eligibility. Owners unmount this boundary before
 * revalidation; Relay retains only its query reference and disposes on unmount.
 * Children receive the variables captured by this reference, even if later URL
 * props change. The feature validates domain unions and owns loading/error UI. */
export function NetworkQuery<T extends OperationType>({
  document,
  scope,
  variables,
  fallback,
  failure,
  children,
  onState,
  onError,
  reuse = false,
}: {
  reuse?: boolean;
  document: GraphQLTaggedNode;
  scope: FinancialScope;
  variables: T['variables'];
  fallback: ReactNode;
  failure: ReactNode;
  children: (data: T['response'], variables: T['variables']) => ReactNode;
  onState?: (state: ReadState) => void;
  onError?: (error: Error) => void;
}) {
  // One keyed visit owns its captured variables, including panel-only URL updates.
  const [captured] = useState(() => variables);
  const [warmVisit, setWarmVisit] = useState(
    () =>
      reuse &&
      scope.isLive() &&
      workspaceFetchPolicy(scope.environment, document, captured) ===
        'store-or-network',
  );
  const warm = useWorkspaceQuery<T>(scope, document, captured, warmVisit);
  // A cold visit keeps its reader after completion, preserving child traversals,
  // forms and recovery owners. An invalidated warm visit becomes cold once.
  if (warmVisit && warm === undefined) setWarmVisit(false);
  const state = useEffectEvent((value: ReadState) => onState?.(value));
  useEffect(() => {
    if (warm !== undefined) state({ busy: false, error: false });
  }, [warm]);
  return (
    <QueryFailure
      fallback={failure}
      onFailure={(error) => {
        onState?.({ busy: false, error: true });
        onError?.(error);
      }}
    >
      {warm !== undefined ? (
        <Suspense fallback={fallback}>
          <WarmResult<T> data={warm} variables={captured}>
            {children}
          </WarmResult>
        </Suspense>
      ) : (
        <PendingQuery<T>
          scope={scope}
          document={document}
          variables={captured}
          fallback={fallback}
          onState={onState}
        >
          {children}
        </PendingQuery>
      )}
    </QueryFailure>
  );
}
function WarmResult<T extends OperationType>({
  data,
  variables,
  children,
}: {
  data: T['response'];
  variables: T['variables'];
  children: (data: T['response'], variables: T['variables']) => ReactNode;
}) {
  return children(data, variables);
}
/** Cold/safety reads retain their effect-owned public preloaded reference. */
function PendingQuery<T extends OperationType>({
  scope,
  document,
  variables,
  fallback,
  onState,
  children,
}: {
  scope: FinancialScope;
  document: GraphQLTaggedNode;
  variables: T['variables'];
  fallback: ReactNode;
  onState?: (state: ReadState) => void;
  children: (data: T['response'], variables: T['variables']) => ReactNode;
}) {
  const environment = useRelayEnvironment();
  const [reference, setReference] = useState<PreloadedQuery<T> | null>(null);
  const state = useEffectEvent((value: ReadState) => onState?.(value));
  useEffect(() => {
    if (!scope.isLive()) return;
    state({ busy: true, error: false });
    const query = loadQuery<T>(environment, document, variables, {
      fetchPolicy: 'network-only',
    });
    // The effect owns this reference even when request-start denial removes its owner.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReference(query);
    return () => query.dispose();
    // Variables are captured by the keyed parent visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment, document]);
  return (
    <Suspense fallback={fallback}>
      {reference ? (
        <QueryResult<T>
          document={document}
          reference={reference}
          onReady={() => onState?.({ busy: false, error: false })}
        >
          {(data) =>
            scope.isLive() ? children(data, reference.variables) : fallback
          }
        </QueryResult>
      ) : (
        fallback
      )}
    </Suspense>
  );
}

/** A pure public Relay snapshot read. The committed subscriber owns retention;
 * abandoned renders own nothing. React rechecks after subscribe, closing the
 * render/commit update, collection and invalidation window. No payload is copied
 * out of Relay and retention never advances the operation's server fetch time. */
export function useWorkspaceQuery<T extends OperationType>(
  scope: FinancialScope,
  document: GraphQLTaggedNode,
  variables: T['variables'],
  enabled = true,
): T['response'] | undefined {
  const identity = JSON.stringify(variables);
  const reader = useMemo(() => {
    if (!enabled)
      return { getSnapshot: () => undefined, subscribe: () => () => {} };
    const environment = scope.environment;
    const operation = createOperationDescriptor(
      getRequest(document),
      variables,
    );
    let snapshot = environment.lookup(operation.fragment);
    const recordIDs = () =>
      snapshot.seenRecords instanceof Set
        ? ([...snapshot.seenRecords] as string[])
        : Object.keys(snapshot.seenRecords);
    let observed = new Map(
      recordIDs().map((id) => [id, environment.getStore().getSource().get(id)]),
    );
    const refreshSnapshot = () => {
      snapshot = environment.lookup(operation.fragment);
      observed = new Map(
        recordIDs().map((id) => [
          id,
          environment.getStore().getSource().get(id),
        ]),
      );
    };
    const getSnapshot = () => {
      // Relay records are immutable. Re-read when a seen record changes, including
      // before subscribe/commit, without manufacturing a new snapshot on every call.
      if (
        scope.isLive() &&
        [...observed].some(
          ([id, record]) =>
            environment.getStore().getSource().get(id) !== record,
        )
      )
        refreshSnapshot();
      return enabled &&
        scope.isLive() &&
        workspaceFetchPolicy(environment, document, variables) ===
          'store-or-network' &&
        !snapshot.isMissingData &&
        !(snapshot as typeof snapshot & { fieldErrors?: readonly unknown[] })
          .fieldErrors?.length
        ? (snapshot.data as T['response'])
        : undefined;
    };
    return {
      getSnapshot,
      subscribe(notify: () => void) {
        if (!enabled || !scope.isLive()) return () => {};
        const retention = environment.retain(operation);
        getSnapshot();
        const subscription = environment.subscribe(snapshot, (next) => {
          snapshot = next;
          observed = new Map(
            recordIDs().map((id) => [
              id,
              environment.getStore().getSource().get(id),
            ]),
          );
          notify();
        });
        const store = environment.getStore();
        const invalidation = store.subscribeToInvalidationState(
          store.lookupInvalidationState(
            snapshot.seenRecords instanceof Set
              ? [...snapshot.seenRecords]
              : Object.keys(snapshot.seenRecords),
          ),
          notify,
        );
        notify();
        return () => {
          subscription.dispose();
          invalidation.dispose();
          retention.dispose();
        };
      },
    };
    // Identity is the operation's serialized variables, never caller object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, document, identity, enabled]);
  return useSyncExternalStore(
    reader.subscribe,
    reader.getSnapshot,
    () => undefined,
  );
}

function QueryResult<T extends OperationType>({
  document,
  reference,
  children,
  onReady,
}: {
  document: GraphQLTaggedNode;
  reference: PreloadedQuery<T>;
  children: (data: T['response']) => ReactNode;
  onReady: () => void;
}) {
  const data = usePreloadedQuery<T>(document, reference);
  const ready = useEffectEvent(onReady);
  useEffect(() => {
    ready();
  }, []);
  return children(data);
}
class QueryFailure extends Component<
  {
    children: ReactNode;
    fallback: ReactNode;
    onFailure: (error: Error) => void;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onFailure(error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Complete overlapping records without a retained fetch timestamp cannot prove
 * bounded freshness. Relay remains the sole owner of both records and age. */
export function workspaceFetchPolicy(
  environment: Environment,
  document: GraphQLTaggedNode,
  variables: Variables,
) {
  const status = environment.check(
    createOperationDescriptor(getRequest(document), variables),
  );
  return status.status === 'available' &&
    status.fetchTime != null &&
    Date.now() - status.fetchTime < 30_000
    ? ('store-or-network' as const)
    : ('network-only' as const);
}
