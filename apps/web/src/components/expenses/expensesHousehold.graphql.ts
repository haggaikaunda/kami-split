import { graphql } from 'relay-runtime';
export const expensesHouseholdQuery = graphql`
  query expensesHouseholdQuery(
    $after: String
    $filter: StructuredExpenseFilter
  ) {
    householdExpenses(first: 6, after: $after, filter: $filter) {
      ...expensesView
    }
  }
`;
