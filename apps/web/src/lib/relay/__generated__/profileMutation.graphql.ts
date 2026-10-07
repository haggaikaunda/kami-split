/**
 * @generated SignedSource<<2551f66d045e1f7f8b8bc3abd2dd8aae>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type profileMutation$variables = {
  displayName: string;
  expectedDisplayName: string;
};
export type profileMutation$data = {
  readonly updateMyProfile: {
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
export type profileMutation = {
  response: profileMutation$data;
  variables: profileMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "displayName"
  },
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "expectedDisplayName"
  }
],
v1 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "displayName",
        "variableName": "displayName"
      },
      {
        "kind": "Variable",
        "name": "expectedDisplayName",
        "variableName": "expectedDisplayName"
      }
    ],
    "concreteType": null,
    "kind": "LinkedField",
    "name": "updateMyProfile",
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
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "profileMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "profileMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "df3ae2206aeb796d116d4c96d5431561",
    "id": null,
    "metadata": {},
    "name": "profileMutation",
    "operationKind": "mutation",
    "text": "mutation profileMutation(\n  $displayName: String!\n  $expectedDisplayName: String!\n) {\n  updateMyProfile(displayName: $displayName, expectedDisplayName: $expectedDisplayName) {\n    __typename\n    ... on Profile {\n      id\n      displayName\n    }\n    ... on ProfileProblem {\n      code\n      message\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "c333ed76dbd007d0bc0f098c8728207d";

export default node;
