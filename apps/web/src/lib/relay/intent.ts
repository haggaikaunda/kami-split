import {
  fetchQuery,
  type GraphQLTaggedNode,
  type OperationType,
  type Variables,
} from 'relay-runtime';
import type { FinancialScope } from './environment';
export type IntentRequest = {
  document: GraphQLTaggedNode;
  variables: Variables;
  key: string;
};
/** One speculative request, with no retained query reference or usable UI result.
 * Cancel before activation; every visit independently reads network-only data.
 * Completed intent only suppresses duplicate focus/hover work for this candidate. */
export function createWorkspaceIntent(scope: FinancialScope) {
  let current:
    { key: string; subscription?: { unsubscribe(): void } } | undefined;
  const cancel = (key?: string) => {
    if (key !== undefined && current?.key !== key) return;
    current?.subscription?.unsubscribe();
    current = undefined;
  };
  return {
    cancel,
    warm(request: IntentRequest) {
      if (!scope.isLive() || current?.key === request.key) return;
      cancel();
      current = { key: request.key };
      current.subscription = fetchQuery<OperationType>(
        scope.environment,
        request.document,
        request.variables,
        { fetchPolicy: 'network-only' },
      ).subscribe({ next() {}, error() {} });
    },
  };
}
