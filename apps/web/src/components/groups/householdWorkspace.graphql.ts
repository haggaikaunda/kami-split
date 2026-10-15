import { graphql } from 'relay-runtime';
export const householdWorkspaceQuery = graphql`
  query householdWorkspaceQuery($recent: Boolean!, $balances: Boolean!) {
    householdDashboard {
      __typename
      ... on Problem {
        code
      }
      ... on HouseholdDashboard {
        ...householdContentDashboard
          @alias(as: "dashboard")
          @arguments(balances: $balances)
      }
    }
    householdExpenses(first: 4) @include(if: $recent) {
      __typename
      ... on Problem {
        code
      }
      ... on ExpenseView {
        edges {
          node: snapshot {
            expenseId
            version
            groupId
            description
            effectiveDate
            totalMinor
            category
            allocations {
              participant {
                id
              }
              amountMinor
            }
          }
          source {
            id
            name
            kind
            isHousehold
            currency
          }
        }
      }
    }
  }
`;
