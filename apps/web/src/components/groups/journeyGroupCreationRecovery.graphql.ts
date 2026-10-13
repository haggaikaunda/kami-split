import { graphql } from 'relay-runtime';
export const journeyGroupCreationRecoveryQuery = graphql`
  query journeyGroupCreationRecoveryQuery($operationKey: OperationKey!) {
    groupCreationOperation(operationKey: $operationKey) {
      __typename
      ... on GroupCreationCompleted {
        operationKey
        groupId
        creatorMembershipId
        createdAt
      }
      ... on GroupCreationRejected {
        operationKey
        fields {
          path
          code
          message
        }
      }
      ... on GroupCreationNotStarted {
        operationKey
      }
      ... on Problem {
        code
        message
      }
    }
  }
`;
