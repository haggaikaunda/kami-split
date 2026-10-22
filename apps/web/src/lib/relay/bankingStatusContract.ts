// Consumer contract fixture, without a mounted UI or a second Relay environment.
// Select streamId: logical account IDs are shared by replacement bindings.
import { graphql } from 'relay-runtime';

export const bankingStatusContractQuery = graphql`
  query bankingStatusContractQuery($connectionId: ID!) {
    bankingConnection(connectionId: $connectionId) {
      code
      connection {
        id
        state
        generation
        deletionGeneration
        permission
        health
        cleanup
        purge
        snapshotRevision
        accounts {
          id
          streamId
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
            requestedAfter
            requestedThrough
            coverageAfter
            coverageThrough
            historicalUpdate
            providerUpdateStatus
            historicalUpdateAt
            lastLocalCommit
            providerSuccessAt
            providerFailedAt
            retryAt
            attempts
            importRevision
            dataRevision
            bindingGeneration
            accountGeneration
            reportingRevision
            planRevision
            intervals {
              bindingId
              afterDate
              throughDate
            }
            discrepancyCount
          }
        }
      }
    }
  }
`;
