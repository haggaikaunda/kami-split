import { graphql } from 'relay-runtime';
export const expensesGroupQuery = graphql`
  query expensesGroupQuery(
    $groupId: ID!
    $after: String
    $filter: StructuredExpenseFilter
  ) {
    groupExpenses(groupId: $groupId, first: 6, after: $after, filter: $filter) {
      ...expensesView
    }
  }
`;
