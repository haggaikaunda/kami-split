import { graphql } from 'relay-runtime';
export const expensesHouseholdContextQuery = graphql`
  query expensesHouseholdContextQuery {
    viewer {
      __typename
      ... on Viewer {
        today
      }
    }
    householdDashboard {
      __typename
      ... on HouseholdDashboard {
        state
        totals {
          __typename
          ... on HouseholdDashboardTotals {
            viewerNetMinor
            activeSpaceCount
          }
        }
        spaces {
          groupId
          name
          currency
          isHousehold
          viewerNetMinor
          viewerMembership {
            id
          }
          members {
            id
            displayName
            status
            role
            canParticipate
          }
        }
      }
    }
  }
`;
