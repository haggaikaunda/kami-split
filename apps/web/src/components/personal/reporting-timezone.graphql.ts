import { graphql } from 'relay-runtime';
export const read = graphql`
  query reportingTimezoneQuery {
    reportingTimezone {
      __typename
      ... on ReportingTimezone {
        timezone
        version
      }
      ... on ReportingTimezoneProblem {
        code
      }
    }
  }
`;
export const initialize = graphql`
  mutation reportingTimezoneInitializeMutation(
    $attemptId: OperationKey!
    $deviceTimezone: String
  ) {
    initializeReportingTimezone(
      attemptId: $attemptId
      deviceTimezone: $deviceTimezone
    ) {
      __typename
      ... on ReportingTimezone {
        timezone
        version
      }
      ... on ReportingTimezoneProblem {
        code
      }
    }
  }
`;
export const update = graphql`
  mutation reportingTimezoneUpdateMutation(
    $attemptId: OperationKey!
    $timezone: String!
    $expectedVersion: ReportingTimezoneVersion!
  ) {
    updateReportingTimezone(
      attemptId: $attemptId
      timezone: $timezone
      expectedVersion: $expectedVersion
    ) {
      __typename
      ... on ReportingTimezone {
        timezone
        version
      }
      ... on ReportingTimezoneProblem {
        code
      }
    }
  }
`;
export const recovery = graphql`
  query reportingTimezoneRecoveryQuery(
    $attemptId: OperationKey!
    $operation: ReportingTimezoneOperation!
  ) {
    reportingTimezoneAttempt(attemptId: $attemptId, operation: $operation) {
      __typename
      ... on ReportingTimezone {
        timezone
        version
      }
      ... on ReportingTimezoneProblem {
        code
      }
    }
  }
`;
