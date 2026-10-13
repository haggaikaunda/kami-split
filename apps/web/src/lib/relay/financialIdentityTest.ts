// Test-only composition: exercise current, anchored and metadata identities in
// one real compiled response. Production documents remain separately owned.
import { graphql } from 'relay-runtime';

export const financialIdentityTestQuery = graphql`
  query financialIdentityTestQuery(
    $expenseId: ID!
    $groupId: ID!
    $after: String
    $filter: StructuredExpenseFilter
  ) {
    node(id: $expenseId) {
      __typename
      ... on Expense {
        id
        version
        description
        totalMinor
        effectiveDate
        category
        note
        split
        payer {
          id
          displayName
        }
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
    groupExpenses(groupId: $groupId, first: 6, after: $after, filter: $filter) {
      ...expensesView
    }
    group(id: $groupId) {
      __typename
      ... on Group {
        id
        name
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
            snapshot {
              expenseId
              version
              description
              totalMinor
              effectiveDate
              category
              note
              split
              payer {
                id
                displayName
              }
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
        }
      }
    }
    groupActivity(groupId: $groupId, first: 20) {
      __typename
      ... on ActivityConnection {
        edges {
          node {
            id
            payer {
              id
              displayName
            }
          }
        }
      }
    }
    viewer {
      __typename
      ... on Viewer {
        id
        displayName
      }
    }
    currentProfile {
      __typename
      ... on Profile {
        id
        displayName
        appearance
      }
    }
  }
`;

// A deliberately smaller selection at the same field arguments proves that a
// refresh cannot retain unselected financial fields from the previous anchor.
export const financialIdentityTestPartialQuery = graphql`
  query financialIdentityTestPartialQuery($groupId: ID!) {
    groupExpenses(groupId: $groupId, first: 6) {
      ... on ExpenseView {
        edges {
          node: snapshot {
            expenseId
            totalMinor
          }
        }
      }
    }
    group(id: $groupId) {
      ... on Group {
        expenses(first: 20) {
          edges {
            snapshot {
              expenseId
              totalMinor
            }
          }
        }
      }
    }
  }
`;
