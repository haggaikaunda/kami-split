'use client';
import {
  Component,
  Suspense,
  useEffect,
  useState,
  useEffectEvent,
  type ReactNode,
} from 'react';
import {
  usePreloadedQuery,
  loadQuery,
  useRelayEnvironment,
  type PreloadedQuery,
} from 'react-relay';
import type { GraphQLTaggedNode, OperationType } from 'relay-runtime';
import type { FinancialScope } from './environment';

type ReadState = { busy: boolean; error: boolean };
/** A mounted, freshly authorized read. Owners unmount this boundary before
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
}: {
  document: GraphQLTaggedNode;
  scope: FinancialScope;
  variables: T['variables'];
  fallback: ReactNode;
  failure: ReactNode;
  children: (data: T['response'], variables: T['variables']) => ReactNode;
  onState?: (state: ReadState) => void;
  onError?: (error: Error) => void;
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
    // The effect owns the public reference even if a request-start access event
    // removes the owner before this state update commits. dispose cancels the
    // network subscription as well as releasing its store retention.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReference(query);
    return () => query.dispose();
    // Query variables are captured for one keyed authorization visit. URL-only
    // panel changes must not reset a retained traversal or durable form draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment, document]);
  return (
    <QueryFailure
      fallback={failure}
      onFailure={(error) => {
        onState?.({ busy: false, error: true });
        onError?.(error);
      }}
    >
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
    </QueryFailure>
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
