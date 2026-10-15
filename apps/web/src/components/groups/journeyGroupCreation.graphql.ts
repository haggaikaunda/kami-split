import { graphql } from 'relay-runtime';
export const journeyGroupCreationMutation = graphql`
  mutation journeyGroupCreationMutation($input: CreateGroupInput!) {
    createGroup(input: $input) {
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
      ... on GroupCreationConflict {
        operationKey
      }
      ... on Problem {
        code
        message
      }
    }
  }
`;
