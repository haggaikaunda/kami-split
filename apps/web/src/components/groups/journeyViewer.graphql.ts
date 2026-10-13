import { graphql } from 'relay-runtime';
export const journeyViewerQuery = graphql`
  query journeyViewerQuery {
    viewer {
      __typename
      ... on Viewer {
        id
        displayName
        today
        canCreateGroups
        groups {
          id
          name
          currency
          kind
          isHousehold
          trip {
            destination
            startDate
            endDate
          }
        }
      }
      ... on ViewerAccess {
        state
      }
      ... on Problem {
        code
        message
      }
    }
  }
`;
