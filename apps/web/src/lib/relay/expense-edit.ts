import { graphql } from 'relay-runtime';
export const expenseEditMutation = graphql`
  mutation expenseEditMutation($input: UpdateExpenseInput!) {
    updateExpense(input: $input) {
      __typename
      ... on ExpenseEditCommitted {
        key
        version
        changed
        record {
          expenseId
          groupId
          totalMinor
        }
      }
      ... on ExpenseEditConflict {
        key
        currentVersion
      }
      ... on ExpenseEditLocked {
        key
        reason
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
export const expenseEditRecoveryQuery = graphql`
  query expenseEditRecoveryQuery($groupId: ID!, $key: OperationKey!) {
    updateExpenseOperation(groupId: $groupId, key: $key) {
      __typename
      ... on ExpenseEditCommitted {
        key
        version
        changed
        record {
          expenseId
          groupId
          totalMinor
        }
      }
      ... on ExpenseEditConflict {
        key
        currentVersion
      }
      ... on ExpenseEditLocked {
        key
        reason
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
export const expenseEditMembersQuery = graphql`
  query expenseEditMembersQuery($groupId: ID!) {
    group(id: $groupId) {
      __typename
      ... on Group {
        id
        members {
          id
          displayName
          canParticipate
        }
      }
      ... on Problem {
        code
      }
    }
  }
`;
