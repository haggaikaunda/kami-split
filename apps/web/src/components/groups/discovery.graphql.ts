import { graphql } from 'relay-runtime';
export const discoveryCard = graphql`
  fragment discoveryCard on GroupDirectoryEntry {
    activeMemberCount
    financialSummary {
      __typename
      ... on GroupFinancialSummary {
        totalSpendMinor
        viewerNetMinor
      }
      ... on Problem {
        code
      }
    }
    group {
      id
      name
      kind
      currency
      isHousehold
      trip {
        destination
        startDate
        endDate
      }
    }
  }
`;
