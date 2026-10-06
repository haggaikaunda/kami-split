import { graphql } from 'relay-runtime';
export const householdWorkspaceQuery = graphql`
  query householdWorkspaceQuery($recent: Boolean!, $balances: Boolean!) {
    householdDashboard {
      __typename
      ... on Problem {
        code
      }
      ... on HouseholdDashboard {
        state
        totals {
          __typename
          ... on HouseholdDashboardTotals {
            viewerNetMinor
            openBalanceCount
            activeSpaceCount
            totalSharedExpenseMinor
            totalSharedExpenseCount
          }
          ... on Problem {
            code
          }
        }
        spaces {
          groupId
          name
          kind
          isHousehold
          currency
          viewerNetMinor
          sharedExpenseCount
          viewerMembership {
            id
            role
          }
          balances @include(if: $balances) {
            __typename
            ... on GroupBalances {
              settled
              obligations {
                from {
                  id
                  displayName
                }
                to {
                  id
                  displayName
                }
                amountMinor
              }
            }
            ... on Problem {
              code
            }
          }
        }
      }
    }
    householdExpenses(first: 5) @include(if: $recent) {
      __typename
      ... on Problem {
        code
      }
      ... on ExpenseView {
        edges {
          node {
            id
            groupId
            description
            effectiveDate
            totalMinor
          }
          source {
            id
            name
            kind
            isHousehold
            currency
          }
        }
      }
    }
  }
`;
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
