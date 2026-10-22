import { graphql } from 'relay-runtime';
export const inventory = graphql`
  query personalInventoryQuery($first: Int!, $after: String) {
    bankingConnections(first: $first, after: $after) {
      __typename
      code
      endCursor
      hasNextPage
      connections {
        id
        state
        health
        cleanup
        purge
        accounts {
          id
          streamId
          name
          kind
          currency
          selected
          requestedHistoryDays
          importStatus {
            operation
            importState
            usable
            recovery
            collection
            reportingState
            freshness
            coverage
            historyAvailability
            historicalUpdate
            lastLocalCommit
            providerSuccessAt
            discrepancyCount
          }
        }
      }
    }
  }
`;
