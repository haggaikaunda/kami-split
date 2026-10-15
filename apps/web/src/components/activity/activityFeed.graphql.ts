import { graphql } from 'relay-runtime';
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
          description
          note
          before {
            description
            totalMinor
            effectiveDate
            category
            note
            payer {
              id
              displayName
            }
            split
            allocations {
              participant {
                id
                displayName
              }
              amountMinor
              percentageHundredths
            }
          }
          after {
            description
            totalMinor
            effectiveDate
            category
            note
            payer {
              id
              displayName
            }
            split
            allocations {
              participant {
                id
                displayName
              }
              amountMinor
              percentageHundredths
            }
          }
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
