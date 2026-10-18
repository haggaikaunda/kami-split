import document, {
  type journeyWorkspaceQuery,
} from './__generated__/journeyWorkspaceQuery.graphql';
import { expenseFilter } from './expense-filter';
export function workspaceRequest(
  id: string,
  tab: string,
  filterText = '',
  expense = false,
  repayment = false,
) {
  const variables: journeyWorkspaceQuery['variables'] = {
    id,
    overview: !expense && !repayment && tab === 'overview',
    balances: repayment || ['overview', 'balances'].includes(tab),
    summary:
      !expense &&
      (repayment || ['overview', 'balances', 'expenses'].includes(tab)),
    ledger: !expense && !repayment && tab === 'expenses',
    activity: !expense && !repayment && tab === 'activity',
    filter: expenseFilter(filterText),
  };
  return { document, variables, key: JSON.stringify(variables) };
}
