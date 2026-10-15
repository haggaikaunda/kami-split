import { graphql } from 'relay-runtime';
export const householdMembersQuery = graphql`
  query householdMembersQuery($id: ID!) {
    group(id: $id) {
      __typename
      ... on Problem {
        code
      }
      ... on Group {
        id
        name
        viewerMembership {
          role
        }
        members {
          id
          displayName
          role
          status
        }
      }
    }
  }
`;
