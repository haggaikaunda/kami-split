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
          ...discoveryCard
          id
          currency
          kind
          isHousehold
          trip {
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
