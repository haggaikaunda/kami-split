/**
 * @generated SignedSource<<0488f212039b707912f1e3ce4f5767aa>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type profileQuery$variables = Record<PropertyKey, never>;
export type profileQuery$data = {
  readonly currentProfile: {
    readonly __typename: "Profile";
    readonly displayName: string;
    readonly id: string;
  } | {
    readonly __typename: "ProfileProblem";
    readonly code: string;
    readonly message: string;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
};
export type profileQuery = {
  response: profileQuery$data;
  variables: profileQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "alias": null,
    "args": null,
    "concreteType": null,
    "kind": "LinkedField",
    "name": "currentProfile",
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
            "name": "id",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "displayName",
            "storageKey": null
          }
        ],
        "type": "Profile",
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
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "message",
            "storageKey": null
          }
        ],
        "type": "ProfileProblem",
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
    "name": "profileQuery",
    "selections": (v0/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "profileQuery",
    "selections": (v0/*:: as any*/)
  },
  "params": {
    "cacheID": "b2f811b3ff01cb7be3ab5a858db89dc0",
    "id": null,
    "metadata": {},
    "name": "profileQuery",
    "operationKind": "query",
    "text": "query profileQuery {\n  currentProfile {\n    __typename\n    ... on Profile {\n      id\n      displayName\n    }\n    ... on ProfileProblem {\n      code\n      message\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "223896b2ca0e2c7b224828ae9384ca63";

export default node;
