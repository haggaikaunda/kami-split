import { graphql } from 'relay-runtime';
export const discoveryCard = graphql`
  fragment discoveryCard on GroupSummary {
    id
    name
    kind
    isHousehold
    trip {
      destination
      startDate
      endDate
    }
  }
`;
