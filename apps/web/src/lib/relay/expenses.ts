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
        node {
          id
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
export const expensesHouseholdContextQuery = graphql`
  query expensesHouseholdContextQuery {
    viewer {
      __typename
      ... on Viewer {
        today
      }
    }
    householdDashboard {
      __typename
      ... on HouseholdDashboard {
        state
        totals {
          __typename
          ... on HouseholdDashboardTotals {
            viewerNetMinor
            activeSpaceCount
          }
        }
        spaces {
          groupId
          name
          currency
          isHousehold
          viewerNetMinor
          viewerMembership {
            id
          }
          members {
            id
            displayName
            status
            role
            canParticipate
          }
        }
      }
    }
  }
`;
export const expensesHouseholdInitialQuery = graphql`
  query expensesHouseholdInitialQuery($filter: StructuredExpenseFilter) {
    householdExpenses(first: 6, filter: $filter) {
      ...expensesView
    }
    viewer {
      __typename
      ... on Viewer {
        today
      }
    }
    householdDashboard {
      __typename
      ... on HouseholdDashboard {
        contextVersion
        state
        totals {
          __typename
          ... on HouseholdDashboardTotals {
            viewerNetMinor
            activeSpaceCount
          }
        }
        spaces {
          groupId
          name
          currency
          isHousehold
          viewerNetMinor
          viewerMembership {
            id
          }
          members {
            id
            displayName
            status
            role
            canParticipate
          }
        }
      }
    }
  }
`;
