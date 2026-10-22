import { graphql } from 'relay-runtime';
export const start = graphql`
  mutation enrollmentStartMutation($input: StartBankingEnrollmentInput!) {
    startBankingEnrollment(input: $input) {
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
export const finish = graphql`
  mutation enrollmentFinishMutation($input: FinishBankingEnrollmentInput!) {
    finishBankingEnrollment(input: $input) {
      __typename
      code
      state
      attemptId
      connectionId
    }
  }
`;
export const cancel = graphql`
  mutation enrollmentCancelMutation($attemptId: ID!) {
    cancelBankingEnrollment(attemptId: $attemptId) {
      __typename
      code
      state
      attemptId
      connectionId
    }
  }
`;
export const recovery = graphql`
  query enrollmentRecoveryQuery($attemptId: ID!) {
    bankingEnrollment(attemptId: $attemptId) {
      __typename
      code
      state
      attemptId
      connectionId
    }
  }
`;
