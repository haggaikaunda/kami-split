import { graphql } from 'relay-runtime';
export const journeyViewerQuery = graphql`
  query journeyViewerQuery {
    viewer {
      __typename
      ... on Viewer {
        id
        displayName
        today
        groups {
          id
          name
          currency
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
        isHousehold
        viewerMembership {
          id
        }
        members {
          id
          displayName
          status
          role
          canParticipate
        }
        expenses(first: 20, after: $after)
          @connection(key: "journey_expenses") {
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
