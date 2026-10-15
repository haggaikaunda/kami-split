import { graphql } from 'relay-runtime';
export const householdContentDashboard = graphql`
  fragment householdContentDashboard on HouseholdDashboard
  @argumentDefinitions(balances: { type: "Boolean!" }) {
    state
    totals {
      __typename
      ... on HouseholdDashboardTotals {
        viewerShareMinor
        viewerPaidMinor
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
`;
