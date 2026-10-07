import { graphql } from 'relay-runtime';
export const profileQuery = graphql`
  query profileQuery {
    currentProfile {
      __typename
      ... on Profile {
        id
        displayName
      }
      ... on ProfileProblem {
        code
        message
      }
    }
  }
`;
export const profileMutation = graphql`
  mutation profileMutation(
    $displayName: String!
    $expectedDisplayName: String!
  ) {
    updateMyProfile(
      displayName: $displayName
      expectedDisplayName: $expectedDisplayName
    ) {
      __typename
      ... on Profile {
        id
        displayName
      }
      ... on ProfileProblem {
        code
        message
      }
    }
  }
`;
