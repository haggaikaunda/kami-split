import { graphql } from 'relay-runtime';
export const expenseEditRecoveryQuery = graphql`
  query expenseEditRecoveryQuery($groupId: ID!, $key: OperationKey!) {
    updateExpenseOperation(groupId: $groupId, key: $key) {
      __typename
      ... on ExpenseEditCommitted {
        key
        version
        changed
        record {
          expenseId
          groupId
          totalMinor
        }
      }
      ... on ExpenseEditConflict {
        key
        currentVersion
      }
      ... on ExpenseEditLocked {
        key
        reason
      }
      ... on ValidationProblem {
        fields {
          path
          code
          message
        }
      }
      ... on OperationProgress {
        key
        state
      }
      ... on Problem {
        code
        message
      }
    }
  }
`;
