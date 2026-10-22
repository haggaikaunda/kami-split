/**
 * @generated SignedSource<<16bf89672144f0d7fada9150244fbb25>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type reportingTimezoneInitializeMutation$variables = {
  attemptId: string;
  deviceTimezone?: string | null | undefined;
};
export type reportingTimezoneInitializeMutation$data = {
  readonly initializeReportingTimezone: {
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
export type reportingTimezoneInitializeMutation = {
  response: reportingTimezoneInitializeMutation$data;
  variables: reportingTimezoneInitializeMutation$variables;
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
    "name": "deviceTimezone"
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
        "name": "deviceTimezone",
        "variableName": "deviceTimezone"
      }
    ],
    "concreteType": null,
    "kind": "LinkedField",
    "name": "initializeReportingTimezone",
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
    "name": "reportingTimezoneInitializeMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "reportingTimezoneInitializeMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "7232c58c2174445ff2ba27c2923bc616",
    "id": null,
    "metadata": {},
    "name": "reportingTimezoneInitializeMutation",
    "operationKind": "mutation",
    "text": "mutation reportingTimezoneInitializeMutation(\n  $attemptId: OperationKey!\n  $deviceTimezone: String\n) {\n  initializeReportingTimezone(attemptId: $attemptId, deviceTimezone: $deviceTimezone) {\n    __typename\n    ... on ReportingTimezone {\n      timezone\n      version\n    }\n    ... on ReportingTimezoneProblem {\n      code\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "956bbc9f68c20b07b9a2376c59870ed6";

export default node;
