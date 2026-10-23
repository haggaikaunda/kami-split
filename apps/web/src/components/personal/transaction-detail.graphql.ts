import { graphql } from 'relay-runtime';
export const detail = graphql`
  fragment personalTransactionDetail on BankingTransaction @inline {
    sourceId
    accountId
    bindingId
    sourceRevision
    latestSourceRevision
    materialRevision
    annotationRevision
    amountMinor
    currency
    bankDate
    authorizationDate
    processingState
    providerPrimaryCategory
    providerCategory
    providerConfidence
    providerCode
    mappingVersion
    name
    merchantName
    categoryOverride
    activityOverride
    note
    excluded
    reviewed
    materialConflict
    current
    currentId
    discrepancy
    category
    activity
    eligible
    archives {
      archiveId
      sourceRevision
      annotationRevision
      annotation {
        revision
        materialRevision
        category
        activity
        note
        excluded
        reviewed
      }
    }
  }
`;
export const mutation = graphql`
  mutation personalTransactionAnnotationMutation(
    $input: BankingAnnotationInput!
  ) {
    editBankingAnnotation(input: $input) {
      __typename
      id
      code
      sourceId
      detail {
        __typename
        id
        code
        currentId
        transaction {
          ...personalTransactionDetail
        }
      }
    }
  }
`;
export const recovery = graphql`
  query personalTransactionAnnotationRecoveryQuery($attemptId: ID!) {
    bankingAnnotationOperation(attemptId: $attemptId) {
      __typename
      id
      code
      sourceId
      detail {
        __typename
        id
        code
        currentId
        transaction {
          ...personalTransactionDetail
        }
      }
    }
  }
`;
