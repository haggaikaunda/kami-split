import { graphql } from 'relay-runtime';
export const workspaceGroup = graphql`
  fragment workspaceGroup on Group
  @argumentDefinitions(
    overview: { type: "Boolean!" }
    balances: { type: "Boolean!" }
    summary: { type: "Boolean!" }
  ) {
    currency
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
`;
