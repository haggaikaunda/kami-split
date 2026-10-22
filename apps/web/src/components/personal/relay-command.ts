import { commitMutation, fetchQuery } from 'relay-runtime';
import type {
  GraphQLTaggedNode,
  MutationParameters,
  OperationType,
} from 'relay-runtime';
import type { FinancialScope } from '@/lib/relay/environment';
/** Commands preserve their original inputs; only a fresh owner scope can observe results. */
export function command<T extends MutationParameters>(
  scope: FinancialScope,
  mutation: GraphQLTaggedNode,
  variables: T['variables'],
): Promise<T['response']> {
  return new Promise((resolve, reject) => {
    if (!scope.isLive()) {
      reject(new Error('SESSION_CHANGED'));
      return;
    }
    commitMutation<T>(scope.environment, {
      mutation,
      variables,
      onCompleted: (result, errors) =>
        scope.isLive() && !errors?.length
          ? resolve(result)
          : reject(new Error('UNAVAILABLE')),
      onError: reject,
    });
  });
}
export async function readFresh<T extends OperationType>(
  scope: FinancialScope,
  query: GraphQLTaggedNode,
  variables: T['variables'],
): Promise<T['response']> {
  if (!scope.isLive()) throw new Error('SESSION_CHANGED');
  const result = await fetchQuery<T>(scope.environment, query, variables, {
    fetchPolicy: 'network-only',
  }).toPromise();
  if (!scope.isLive() || !result) throw new Error('UNAVAILABLE');
  return result;
}
