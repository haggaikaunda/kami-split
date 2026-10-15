import { graphql } from 'relay-runtime';
export const expenseEditCurrentQuery = graphql`
  query expenseEditCurrentQuery($id: ID!) {
    node(id: $id) {
      __typename
      ... on Expense {
        id
        groupId
        version
        canEdit
        editLockReason
        description
        effectiveDate
        totalMinor
        currency
        createdAt
        creator {
          id
          displayName
        }
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
  }
`;
