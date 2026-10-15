import { graphql } from 'relay-runtime';
export const expenseEditMutation = graphql`
  mutation expenseEditMutation($input: UpdateExpenseInput!) {
    updateExpense(input: $input) {
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
      ... on OperationMismatch {
        key
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
