import { graphql } from 'relay-runtime';
export const journeyWorkspaceQuery = graphql`
  query journeyWorkspaceQuery(
    $id: ID!
    $overview: Boolean!
    $balances: Boolean!
    $summary: Boolean!
    $ledger: Boolean!
    $activity: Boolean!
    $filter: StructuredExpenseFilter
  ) {
    groupExpenses(groupId: $id, first: 6, filter: $filter)
      @include(if: $ledger) {
      ...expensesView
    }
    groupActivity(groupId: $id, first: 20) @include(if: $activity) {
      ...activityFeed
    }
    viewer {
      __typename
      ... on Problem {
        code
      }
      ... on ViewerAccess {
        state
      }
      ... on Viewer {
        today
      }
    }
    group(id: $id) {
      __typename
      ... on Problem {
        code
      }
      ... on Group {
        id
        name
        kind
        isHousehold
        ...workspaceGroup
          @alias(as: "workspace")
          @arguments(
            overview: $overview
            balances: $balances
            summary: $summary
          )
      }
    }
  }
`;
