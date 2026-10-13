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
