import { graphql } from 'relay-runtime';
export const report = graphql`
  query personalTransactionsQuery(
    $filter: BankingReportFilter
    $after: String
  ) {
    bankingReport(filter: $filter, first: 50, after: $after) {
      id
      code
      fieldErrors
      start
      end
      asOfDate
      timezone
      revision
      totalCount
      spendingContext
      endCursor
      hasNextPage
      activityChoices
      categoryChoices
      counts {
        count
        postedCount
        pendingCount
        removedCount
        excludedCount
        unresolvedCount
        reviewedCount
        classificationComplete
      }
      summary {
        netMinor
        purchaseMinor
        refundMinor
        classificationComplete
      }
      accounts {
        id
        accountId
        kind
        selected
        coverage
        planId
        transitionDate
        archives {
          id
          planId
          boundaryDate
          count
        }
        intervals {
          bindingId
          afterDate
          throughDate
          importState
          coverage
          coverageAfter
          coverageThrough
          collectionState
          collectionStopped
          lastLocalCommit
          providerSuccessAt
          discrepancyCount
        }
      }
      rows {
        sourceId
        ...personalTransactionRow
      }
    }
  }
`;
export const row = graphql`
  fragment personalTransactionRow on BankingTransaction {
    sourceId
    accountId
    bindingId
    sourceRevision
    latestSourceRevision
    bankDate
    amountMinor
    currency
    merchantName
    name
    processingState
    activity
    category
    excluded
    reviewed
    materialConflict
    current
    currentId
    discrepancy
    archives {
      archiveId
      sourceRevision
      annotationRevision
      annotation {
        revision
        note
        excluded
        reviewed
      }
    }
  }
`;
export const selection = graphql`
  query personalTransactionSelectionQuery(
    $source: ID!
    $archive: ID
    $discrepancy: Boolean
  ) {
    bankingTransaction(
      sourceId: $source
      archiveId: $archive
      discrepancy: $discrepancy
    ) {
      id
      code
      currentId
      transaction {
        ...personalTransactionRow
        ...personalTransactionDetail
      }
    }
  }
`;
