import { graphql } from 'relay-runtime';
export const journeyViewerQuery = graphql`
  query journeyViewerQuery {
    viewer {
      __typename
      ... on Viewer {
        id
        displayName
        today
        canCreateGroups
        groups {
          id
          name
          currency
          kind
          isHousehold
          trip {
            destination
            startDate
            endDate
          }
        }
      }
      ... on ViewerAccess {
        state
      }
      ... on Problem {
        code
        message
      }
    }
  }
`;

export const journeyGroupQuery = graphql`
  query journeyGroupQuery($id: ID!, $after: String) {
    group(id: $id) {
      __typename
      ... on Problem {
        code
        message
      }
      ... on Group {
        id
        name
        currency
        kind
        isHousehold
        trip {
          destination
          startDate
          endDate
        }
        viewerMembership {
          id
          role
        }
        members {
          id
          displayName
          status
          role
          canParticipate
        }
        expenses(first: 20, after: $after) {
          revision
          edges {
            cursor
            node {
              id
              description
              effectiveDate
              totalMinor
              category
              note
              payer {
                id
                displayName
              }
              allocations {
                participant {
                  id
                  displayName
                }
                amountMinor
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
        }
        repayments(first: 5) {
          edges {
            node {
              id
              groupId
              amountMinor
              effectiveDate
              note
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
          }
        }
        balances {
          __typename
          ... on Problem {
            code
            message
          }
          ... on GroupBalances {
            groupId
            revision
            totalExpenseMinor
            settled
            positions {
              member {
                id
                displayName
                status
              }
              paidMinor
              owedMinor
              sentMinor
              receivedMinor
              netMinor
            }
            obligations {
              from {
                id
                displayName
              }
              to {
                id
                displayName
              }
              amountMinor
            }
          }
        }
      }
    }
  }
`;

export const journeyCreateMutation = graphql`
  mutation journeyCreateMutation($input: CreateExpenseInput!) {
    createExpense(input: $input) {
      __typename
      ... on ExpenseCommitted {
        key
        record {
          expenseId
          groupId
          totalMinor
          revision
        }
      }
      ... on ValidationProblem {
        fields {
          path
          code
          message
        }
      }
      ... on OperationMismatch {
        key
      }
      ... on OperationProgress {
        key
        state
      }
      ... on Problem {
        code
        message
      }
    }
  }
`;

export const journeyRecoveryQuery = graphql`
  query journeyRecoveryQuery($groupId: ID!, $key: OperationKey!) {
    expenseOperation(groupId: $groupId, key: $key) {
      __typename
      ... on ExpenseCommitted {
        key
        record {
          expenseId
          groupId
          totalMinor
          revision
        }
      }
      ... on ValidationProblem {
        fields {
          path
          code
          message
        }
      }
      ... on OperationProgress {
        key
        state
      }
      ... on Problem {
        code
        message
      }
    }
  }
`;

export const journeyExpenseQuery = graphql`
  query journeyExpenseQuery($id: ID!) {
    node(id: $id) {
      __typename
      ... on Expense {
        id
        groupId
        description
        effectiveDate
        totalMinor
        currency
        createdAt
        creator {
          id
          displayName
        }
        category
        note
        payer {
          id
          displayName
        }
        allocations {
          participant {
            id
            displayName
          }
          amountMinor
        }
      }
    }
  }
`;

export const journeyRepaymentMutation = graphql`
  mutation journeyRepaymentMutation($input: RecordRepaymentInput!) {
    recordRepayment(input: $input) {
      __typename
      ... on RepaymentCommitted {
        key
        record {
          repaymentId
          groupId
          senderMembershipId
          recipientMembershipId
          amountMinor
          currency
          effectiveDate
          note
        }
      }
      ... on ValidationProblem {
        fields {
          path
          code
          message
        }
      }
      ... on OperationMismatch {
        key
      }
      ... on OperationProgress {
        key
        state
      }
      ... on Problem {
        code
        message
      }
    }
  }
`;
export const journeyRepaymentRecoveryQuery = graphql`
  query journeyRepaymentRecoveryQuery($groupId: ID!, $key: OperationKey!) {
    repaymentOperation(groupId: $groupId, key: $key) {
      __typename
      ... on RepaymentCommitted {
        key
        record {
          repaymentId
          groupId
          senderMembershipId
          recipientMembershipId
          amountMinor
          currency
          effectiveDate
          note
        }
      }
      ... on ValidationProblem {
        fields {
          path
          code
          message
        }
      }
      ... on OperationProgress {
        key
        state
      }
      ... on Problem {
        code
        message
      }
    }
  }
`;

export const journeyGroupCreationMutation = graphql`
  mutation journeyGroupCreationMutation($input: CreateGroupInput!) {
    createGroup(input: $input) {
      __typename
      ... on GroupCreationCompleted {
        operationKey
        groupId
        creatorMembershipId
        createdAt
      }
      ... on GroupCreationRejected {
        operationKey
        fields {
          path
          code
          message
        }
      }
      ... on GroupCreationConflict {
        operationKey
      }
      ... on Problem {
        code
        message
      }
    }
  }
`;
export const journeyGroupCreationRecoveryQuery = graphql`
  query journeyGroupCreationRecoveryQuery($operationKey: OperationKey!) {
    groupCreationOperation(operationKey: $operationKey) {
      __typename
      ... on GroupCreationCompleted {
        operationKey
        groupId
        creatorMembershipId
        createdAt
      }
      ... on GroupCreationRejected {
        operationKey
        fields {
          path
          code
          message
        }
      }
      ... on GroupCreationNotStarted {
        operationKey
      }
      ... on Problem {
        code
        message
      }
    }
  }
`;
