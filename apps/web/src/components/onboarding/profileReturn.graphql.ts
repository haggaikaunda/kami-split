import { graphql } from 'relay-runtime';
export const profileReturnQuery = graphql`
  query profileReturnQuery {
    viewer {
      __typename
      ... on Viewer {
        groups {
          id
          name
        }
      }
    }
  }
`;
