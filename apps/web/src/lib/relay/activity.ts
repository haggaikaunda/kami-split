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
