/**
 * @generated SignedSource<<009d97a969f6c960e0d0f6982167ed09>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type HouseholdDashboardState = "COMPLETE" | "INCOMPLETE" | "UNAVAILABLE" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
export type householdAccessQuery$variables = Record<PropertyKey, never>;
export type householdAccessQuery$data = {
  readonly householdDashboard: {
    readonly __typename: "HouseholdDashboard";
    readonly spaces: ReadonlyArray<{
      readonly groupId: string;
      readonly isHousehold: boolean;
    }>;
    readonly state: HouseholdDashboardState;
  } | {
    readonly __typename: "Problem";
    readonly code: ProblemCode;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
};
export type householdAccessQuery = {
  response: householdAccessQuery$data;
  variables: householdAccessQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "alias": null,
    "args": null,
    "concreteType": null,
    "kind": "LinkedField",
    "name": "householdDashboard",
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
            "name": "code",
            "storageKey": null
          }
        ],
        "type": "Problem",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": [
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "state",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "HouseholdDashboardSpace",
            "kind": "LinkedField",
            "name": "spaces",
            "plural": true,
            "selections": [
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "groupId",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "isHousehold",
                "storageKey": null
              }
            ],
            "storageKey": null
          }
        ],
        "type": "HouseholdDashboard",
        "abstractKey": null
      }
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": [],
    "kind": "Fragment",
    "metadata": null,
    "name": "householdAccessQuery",
    "selections": (v0/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "householdAccessQuery",
    "selections": (v0/*:: as any*/)
  },
  "params": {
    "cacheID": "56bf81819fb3a64b7925c11125192234",
    "id": null,
    "metadata": {},
    "name": "householdAccessQuery",
    "operationKind": "query",
    "text": "query householdAccessQuery {\n  householdDashboard {\n    __typename\n    ... on Problem {\n      code\n    }\n    ... on HouseholdDashboard {\n      state\n      spaces {\n        groupId\n        isHousehold\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "1224577f04d9960a228604ae45b4327c";

export default node;
