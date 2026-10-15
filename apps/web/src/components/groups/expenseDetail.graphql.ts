import { graphql } from 'relay-runtime';
export const expenseDetailExpense = graphql`
  fragment expenseDetailExpense on Expense {
    __typename
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
`;
