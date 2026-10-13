import { graphql } from 'relay-runtime';
export const journeyRepaymentRecoveryQuery = graphql`
  query journeyRepaymentRecoveryQuery($groupId: ID!, $key: OperationKey!) {
    repaymentOperation(groupId: $groupId, key: $key) {
      __typename
      ... on RepaymentCommitted {
        key
        record {
          repaymentId
          groupId
          senderMembershipId
          recipientMembershipId
          amountMinor
          currency
          effectiveDate
          note
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
