import { graphql } from 'relay-runtime';
export const expensesHouseholdInitialQuery = graphql`
  query expensesHouseholdInitialQuery($filter: StructuredExpenseFilter) {
    householdExpenses(first: 6, filter: $filter) {
      ...expensesView
    }
    viewer {
      __typename
      ... on Viewer {
        today
      }
    }
    householdDashboard {
      __typename
      ... on HouseholdDashboard {
        contextVersion
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
