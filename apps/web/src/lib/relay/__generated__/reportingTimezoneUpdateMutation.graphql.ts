/**
 * @generated SignedSource<<921cf1d7d96b48a6d240a7d61ce7332e>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type reportingTimezoneUpdateMutation$variables = {
  attemptId: string;
  expectedVersion: string;
  timezone: string;
};
export type reportingTimezoneUpdateMutation$data = {
  readonly updateReportingTimezone: {
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
export type reportingTimezoneUpdateMutation = {
  response: reportingTimezoneUpdateMutation$data;
  variables: reportingTimezoneUpdateMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "attemptId"
},
v1 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "expectedVersion"
},
v2 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "timezone"
},
v3 = [
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
        "name": "expectedVersion",
        "variableName": "expectedVersion"
      },
      {
        "kind": "Variable",
        "name": "timezone",
        "variableName": "timezone"
      }
    ],
    "concreteType": null,
    "kind": "LinkedField",
    "name": "updateReportingTimezone",
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
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/),
      (v2/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "reportingTimezoneUpdateMutation",
    "selections": (v3/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v2/*:: as any*/),
      (v1/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "reportingTimezoneUpdateMutation",
    "selections": (v3/*:: as any*/)
  },
  "params": {
    "cacheID": "f6ef0c099f121cc04ea8b7d02573117f",
    "id": null,
    "metadata": {},
    "name": "reportingTimezoneUpdateMutation",
    "operationKind": "mutation",
    "text": "mutation reportingTimezoneUpdateMutation(\n  $attemptId: OperationKey!\n  $timezone: String!\n  $expectedVersion: ReportingTimezoneVersion!\n) {\n  updateReportingTimezone(attemptId: $attemptId, timezone: $timezone, expectedVersion: $expectedVersion) {\n    __typename\n    ... on ReportingTimezone {\n      timezone\n      version\n    }\n    ... on ReportingTimezoneProblem {\n      code\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "0cb77b830296c4543c784b7449882249";

export default node;
