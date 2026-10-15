import { graphql } from 'relay-runtime';
export const householdAccessQuery = graphql`
  query householdAccessQuery {
    viewer {
      __typename
      ... on Problem {
        code
      }
      ... on Viewer {
        groups {
          id
          isHousehold
        }
      }
    }
  }
`;
