import { graphql } from 'relay-runtime';
export const journeyCreateMutation = graphql`
  mutation journeyCreateMutation($input: CreateExpenseInput!) {
    createExpense(input: $input) {
      __typename
      ... on ExpenseCommitted {
        key
        record {
          expenseId
          groupId
          totalMinor
          revision
          split
          allocations {
            participantId
            amountMinor
            percentageHundredths
          }
        }
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
