import { graphql } from 'relay-runtime';
export const expensesView = graphql`
  fragment expensesView on ExpenseViewResult @inline {
    __typename
    ... on Problem {
      code
    }
    ... on ExpenseView {
      contextVersion
      totalExpenseMinor
      viewerShareMinor
      viewerPaidMinor
      categories {
        category
        totalExpenseMinor
        viewerShareMinor
        expenseCount
      }
      expenseCount
      months {
        month
        totalExpenseMinor
        expenseCount
      }
      edges {
        cursor
        source {
          name
          currency
        }
        node: snapshot {
          expenseId
          groupId
          description
          effectiveDate
          category
          totalMinor
          payer {
            id
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
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;
