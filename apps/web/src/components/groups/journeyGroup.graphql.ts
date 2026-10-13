import { graphql } from 'relay-runtime';
export const journeyGroupQuery = graphql`
  query journeyGroupQuery($id: ID!, $after: String) {
    group(id: $id) {
      __typename
      ... on Problem {
        code
        message
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
        expenses(first: 20, after: $after) {
          revision
          edges {
            cursor
            node: snapshot {
              expenseId
              version
              description
              effectiveDate
              totalMinor
              category
              note
              payer {
                id
                displayName
              }
              split
              allocations {
                participant {
                  id
                  displayName
                }
                amountMinor
                percentageHundredths
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
        }
        repayments(first: 5) {
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
        balances {
          __typename
          ... on Problem {
            code
            message
          }
          ... on GroupBalances {
            groupId
            revision
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
        }
      }
    }
  }
`;
