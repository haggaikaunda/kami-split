import { graphql } from 'relay-runtime';
export const appearanceQuery = graphql`
  query appearanceQuery {
    currentProfile {
      __typename
      ... on Profile {
        appearance
      }
    }
  }
`;
export const appearanceMutation = graphql`
  mutation appearanceMutation(
    $appearance: Appearance!
    $expectedAppearance: Appearance!
  ) {
    updateMyAppearance(
      appearance: $appearance
      expectedAppearance: $expectedAppearance
    ) {
      __typename
      ... on Profile {
        appearance
      }
      ... on ProfileProblem {
        code
        message
      }
    }
  }
`;
