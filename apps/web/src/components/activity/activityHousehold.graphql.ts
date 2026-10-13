import { graphql } from 'relay-runtime';
export const activityHouseholdQuery = graphql`
  query activityHouseholdQuery($after: String, $filter: ActivityFilter) {
    householdActivity(first: 20, after: $after, filter: $filter) {
      ...activityFeed
    }
  }
`;
