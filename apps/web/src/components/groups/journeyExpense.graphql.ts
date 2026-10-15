import { graphql } from 'relay-runtime';
export const journeyExpenseQuery = graphql`
  query journeyExpenseQuery($id: ID!) {
    node(id: $id) {
      __typename
      ... on Expense {
        id
        groupId
        ...expenseDetailExpense @alias(as: "expense")
      }
    }
  }
`;
