import { graphql } from 'relay-runtime';
export const journeyRepaymentMutation = graphql`
  mutation journeyRepaymentMutation($input: RecordRepaymentInput!) {
    recordRepayment(input: $input) {
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
