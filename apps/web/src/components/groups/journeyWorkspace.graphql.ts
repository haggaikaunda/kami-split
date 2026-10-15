import { graphql } from 'relay-runtime';
export const journeyWorkspaceQuery = graphql`
  query journeyWorkspaceQuery(
    $id: ID!
    $overview: Boolean!
    $balances: Boolean!
    $summary: Boolean!
    $ledger: Boolean!
    $activity: Boolean!
    $filter: StructuredExpenseFilter
  ) {
    groupExpenses(groupId: $id, first: 6, filter: $filter)
      @include(if: $ledger) {
      ...expensesView
    }
    groupActivity(groupId: $id, first: 20) @include(if: $activity) {
      ...activityFeed
    }
    viewer {
      __typename
      ... on Problem {
        code
      }
      ... on ViewerAccess {
        state
      }
      ... on Viewer {
        today
      }
    }
    group(id: $id) {
      __typename
      ... on Problem {
        code
      }
      ... on Group {
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
        viewerMembership {
          id
          role
        }
        members {
          id
          displayName
          status
          role
          canParticipate
        }
        expenses(first: 4) @include(if: $overview) {
          edges {
            cursor
            node: snapshot {
              expenseId
              description
              effectiveDate
              totalMinor
              category
              payer {
                displayName
              }
              allocations {
                participant {
                  id
                }
                amountMinor
              }
            }
          }
        }
        repayments(first: 5) @include(if: $balances) {
          edges {
            node {
              id
              groupId
              amountMinor
              effectiveDate
              note
              sender {
                id
                displayName
              }
              recipient {
                id
                displayName
              }
            }
          }
          pageInfo {
            hasNextPage
          }
        }
        balances @include(if: $summary) {
          __typename
          ... on GroupBalances {
            groupId
            totalExpenseMinor
            settled
            positions {
              member {
                id
                displayName
                status
              }
              paidMinor
              owedMinor
              sentMinor
              receivedMinor
              netMinor
            }
            obligations @include(if: $balances) {
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
        }
      }
    }
  }
`;
