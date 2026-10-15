import { graphql } from 'relay-runtime';
export const expenseEditMembersQuery = graphql`
  query expenseEditMembersQuery($groupId: ID!) {
    group(id: $groupId) {
      __typename
      ... on Group {
        id
        members {
          id
          displayName
          canParticipate
        }
      }
      ... on Problem {
        code
      }
    }
  }
`;
