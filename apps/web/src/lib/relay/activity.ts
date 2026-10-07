import { graphql } from 'relay-runtime';
export const activityGroupQuery = graphql`
  query activityGroupQuery(
    $groupId: ID!
    $after: String
    $filter: ActivityFilter
  ) {
    groupActivity(
      groupId: $groupId
      first: 20
      after: $after
      filter: $filter
    ) {
      ...activityFeed
    }
  }
`;
export const activityHouseholdQuery = graphql`
  query activityHouseholdQuery($after: String, $filter: ActivityFilter) {
    householdActivity(first: 20, after: $after, filter: $filter) {
      ...activityFeed
    }
  }
`;
export const activityFeed = graphql`
  fragment activityFeed on ActivityResult @inline {
    __typename
    ... on Problem {
      code
      message
    }
    ... on ActivityConnection {
      edges {
        cursor
        node {
          id
          recordId
          kind
          groupId
          groupName
          isHousehold
          groupKind
          amountMinor
          currency
          effectiveDate
          timestamp
          creator {
            id
            displayName
          }
          payer {
            id
            displayName
          }
          sender {
            id
            displayName
          }
          recipient {
            id
            displayName
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
export const activityDetailQuery = graphql`
  query activityDetailQuery($id: ID!) {
    node(id: $id) {
      __typename
      ... on Expense {
        id
        groupId
        description
        totalMinor
        currency
        effectiveDate
        createdAt
        payer {
          displayName
        }
      }
      ... on Repayment {
        id
        groupId
        amountMinor
        currency
        effectiveDate
        createdAt
        sender {
          displayName
        }
        recipient {
          displayName
        }
      }
    }
  }
`;
