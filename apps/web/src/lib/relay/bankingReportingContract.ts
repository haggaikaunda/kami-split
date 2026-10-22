// Consumer normalization contract only; Personal browser screens remain separate.
import { graphql } from 'relay-runtime';

export const bankingReportingContractQuery = graphql`
  query bankingReportingContractQuery(
    $filter: BankingReportFilter
    $after: String
    $source: ID!
    $archive: ID!
  ) {
    bankingReport(filter: $filter, first: 1, after: $after) {
      id
      summary {
        netMinor
      }
      accounts {
        id
        accountId
        coverage
        intervals {
          bindingId
          coverage
        }
      }
      rows {
        ...bankingReportingContractTransaction
      }
    }
    canonical: bankingTransaction(sourceId: $source) {
      transaction {
        ...bankingReportingContractTransaction
      }
    }
    correction: bankingTransaction(sourceId: $source, discrepancy: true) {
      transaction {
        ...bankingReportingContractTransaction
      }
    }
    archived: bankingTransaction(sourceId: $source, archiveId: $archive) {
      transaction {
        ...bankingReportingContractTransaction
      }
    }
  }
`;
export const bankingReportingContractTransaction = graphql`
  fragment bankingReportingContractTransaction on BankingTransaction @inline {
    id
    sourceId
    sourceRevision
    amountMinor
    annotationRevision
    note
    excluded
    current
    archives {
      archiveId
      annotation {
        revision
        note
        excluded
      }
    }
  }
`;
export const bankingReportingContractPartialQuery = graphql`
  query bankingReportingContractPartialQuery(
    $filter: BankingReportFilter
    $after: String
  ) {
    bankingReport(filter: $filter, first: 1, after: $after) {
      rows {
        id
        sourceId
        note
      }
    }
  }
`;
