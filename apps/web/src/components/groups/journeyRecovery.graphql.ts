import { graphql } from 'relay-runtime';
export const journeyRecoveryQuery = graphql`
  query journeyRecoveryQuery($groupId: ID!, $key: OperationKey!) {
    expenseOperation(groupId: $groupId, key: $key) {
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
