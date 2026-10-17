import { graphql } from 'relay-runtime';
export const journeyViewerQuery = graphql`
  query journeyViewerQuery {
    groupDirectory {
      __typename
      ... on GroupDirectory {
        entries {
          ...discoveryCard
          group {
            id
            kind
            isHousehold
            trip {
              startDate
              endDate
            }
          }
        }
      }
      ... on Problem {
        code
      }
    }
    viewer {
      __typename
      ... on Viewer {
        id
        displayName
        today
        canCreateGroups
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
