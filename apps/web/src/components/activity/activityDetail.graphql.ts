import { graphql } from 'relay-runtime';
export const activityDetailQuery = graphql`
  query activityDetailQuery($eventId: ID!, $groupId: ID) {
    activityEvent(eventId: $eventId, groupId: $groupId) {
      __typename
      ... on Problem {
        code
        message
      }
      ... on ActivityEvent {
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
        description
        note
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
      }
    }
  }
`;
