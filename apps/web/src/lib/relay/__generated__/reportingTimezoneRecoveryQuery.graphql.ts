/**
 * @generated SignedSource<<4745725a637a54f3a932a951da5078e1>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type ReportingTimezoneOperation = "INITIALIZE" | "UPDATE" | "%future added value";
export type reportingTimezoneRecoveryQuery$variables = {
  attemptId: string;
  operation: ReportingTimezoneOperation;
};
export type reportingTimezoneRecoveryQuery$data = {
  readonly reportingTimezoneAttempt: {
    readonly __typename: "ReportingTimezone";
    readonly timezone: string;
    readonly version: string;
  } | {
    readonly __typename: "ReportingTimezoneProblem";
    readonly code: string;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
};
export type reportingTimezoneRecoveryQuery = {
  response: reportingTimezoneRecoveryQuery$data;
  variables: reportingTimezoneRecoveryQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "attemptId"
  },
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "operation"
  }
],
v1 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "attemptId",
        "variableName": "attemptId"
      },
      {
        "kind": "Variable",
        "name": "operation",
        "variableName": "operation"
      }
    ],
    "concreteType": null,
    "kind": "LinkedField",
    "name": "reportingTimezoneAttempt",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "__typename",
        "storageKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": [
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "timezone",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "version",
            "storageKey": null
          }
        ],
        "type": "ReportingTimezone",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": [
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "code",
            "storageKey": null
          }
        ],
        "type": "ReportingTimezoneProblem",
        "abstractKey": null
      }
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "reportingTimezoneRecoveryQuery",
    "selections": (v1/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "reportingTimezoneRecoveryQuery",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "9a4239b58731e31729209956b35f6fe6",
    "id": null,
    "metadata": {},
    "name": "reportingTimezoneRecoveryQuery",
    "operationKind": "query",
    "text": "query reportingTimezoneRecoveryQuery(\n  $attemptId: OperationKey!\n  $operation: ReportingTimezoneOperation!\n) {\n  reportingTimezoneAttempt(attemptId: $attemptId, operation: $operation) {\n    __typename\n    ... on ReportingTimezone {\n      timezone\n      version\n    }\n    ... on ReportingTimezoneProblem {\n      code\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "5502d2c71cd30620eb839e844a76688a";

export default node;
