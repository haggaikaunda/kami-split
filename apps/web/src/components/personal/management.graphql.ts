import { graphql } from 'relay-runtime';
export const connection = graphql`
  query managementConnectionQuery($connectionId: ID!) {
    bankingConnection(connectionId: $connectionId) {
      __typename
      code
      connection {
        id
        institutionName
        permission
        state
        generation
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
          providerAccountId
          importStatus {
            reportingState
            collection
            discrepancyCount
          }
        }
      }
    }
  }
`;
export const selection = graphql`
  mutation managementSelectionMutation($input: BankingSelectionInput!) {
    changeBankingSelection(input: $input) {
      __typename
      code
    }
  }
`;
export const disconnect = graphql`
  mutation managementDisconnectMutation($input: BankingFenceInput!) {
    disconnectBanking(input: $input) {
      __typename
      code
    }
  }
`;
export const remove = graphql`
  mutation managementDeleteMutation($input: BankingFenceInput!) {
    deleteBankingHistory(input: $input) {
      __typename
      code
    }
  }
`;
export const operation = graphql`
  query managementOperationQuery($attemptId: ID!) {
    bankingOperation(attemptId: $attemptId) {
      __typename
      code
    }
  }
`;
export const startRepair = graphql`
  mutation managementRepairStartMutation($input: BankingFenceInput!) {
    startBankingRepair(input: $input) {
      __typename
      code
      state
      attemptId
      linkToken
      expiresAt
    }
  }
`;
export const finishRepair = graphql`
  mutation managementRepairFinishMutation($input: FinishBankingRepairInput!) {
    finishBankingRepair(input: $input) {
      __typename
      code
      state
      attemptId
    }
  }
`;
export const repairStatus = graphql`
  query managementRepairQuery($attemptId: ID!) {
    bankingRepair(attemptId: $attemptId) {
      __typename
      code
      state
      attemptId
    }
  }
`;
export const replacementStart = graphql`
  mutation managementReplacementStartMutation(
    $input: StartBankingReplacementInput!
  ) {
    startBankingReplacement(input: $input) {
      __typename
      code
      state
      attemptId
      connectionId
      linkToken
      expiresAt
    }
  }
`;
export const preview = graphql`
  query managementPreviewQuery($input: BankingReplacementRequest!) {
    bankingReplacementPreview(input: $input) {
      __typename
      code
      reportingRevision
      coverage
      coverageAfter
      coverageThrough
      discrepancyCount
      collectionState
      revisions {
        plan
        import
        data
        annotation
        lifecycle
      }
      intervals {
        bindingId
        afterDate
        throughDate
      }
      prior {
        ...managementImpact
      }
      proposed {
        ...managementImpact
      }
      retained {
        ...managementImpact
      }
      new {
        ...managementImpact
      }
      archived {
        ...managementImpact
      }
      overlap {
        ...managementImpact
      }
      oldAfterBoundary {
        ...managementImpact
      }
    }
  }
`;
export const impact = graphql`
  fragment managementImpact on BankingReplacementImpact @inline {
    count
    fromDate
    throughDate
    spendingMinor
    annotationCount
    pendingCount
    unresolvedCount
  }
`;
export const confirm = graphql`
  mutation managementConfirmMutation($input: ConfirmBankingReplacementInput!) {
    confirmBankingReplacement(input: $input) {
      __typename
      code
      resultId
    }
  }
`;
export const cancel = graphql`
  mutation managementCancelMutation($input: ConfirmBankingReplacementInput!) {
    cancelBankingReplacement(input: $input) {
      __typename
      code
      resultId
    }
  }
`;
export const replacementOperation = graphql`
  query managementReplacementOperationQuery($attemptId: ID!) {
    bankingReplacementOperation(attemptId: $attemptId) {
      __typename
      code
      resultId
    }
  }
`;
export const recovery = graphql`
  query managementRecoveryQuery($filter: BankingReportFilter!) {
    bankingReport(filter: $filter, first: 1) {
      __typename
      id
      code
      asOfDate
      accounts {
        id
        accountId
        planId
        predecessorId
        transitionDate
        intervals {
          bindingId
          afterDate
          throughDate
        }
        archives {
          id
          planId
          boundaryDate
          count
        }
      }
    }
  }
`;
export const archive = graphql`
  query managementArchiveQuery($filter: BankingReportFilter!, $after: String) {
    bankingReport(filter: $filter, first: 20, after: $after) {
      __typename
      id
      code
      totalCount
      hasNextPage
      endCursor
      rows {
        id
        sourceId
        currentId
        current
        bankDate
        amountMinor
        currency
        name
        sourceRevision
        latestSourceRevision
        annotationRevision
        note
        excluded
        discrepancy
        archives {
          archiveId
          sourceRevision
          annotationRevision
          annotation {
            revision
            note
            excluded
          }
        }
      }
    }
  }
`;
export const stages = graphql`
  query managementStagesQuery($after: String) {
    bankingConnections(first: 50, after: $after) {
      __typename
      code
      endCursor
      hasNextPage
      connections {
        id
        accounts {
          id
          streamId
          name
          importStatus {
            reportingState
          }
        }
      }
    }
  }
`;
export const current = graphql`
  query managementCurrentQuery($sourceId: ID!) {
    bankingTransaction(sourceId: $sourceId) {
      __typename
      id
      code
      currentId
      transaction {
        id
        sourceId
        bankDate
        amountMinor
        name
        note
        annotationRevision
        sourceRevision
      }
    }
  }
`;
