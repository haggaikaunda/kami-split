/**
 * @generated SignedSource<<cbdb9ea214fb36bb6b3ed8d6da9024f3>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type Appearance = "DARK" | "LIGHT" | "SYSTEM" | "%future added value";
export type appearanceMutation$variables = {
  appearance: Appearance;
  expectedAppearance: Appearance;
};
export type appearanceMutation$data = {
  readonly updateMyAppearance: {
    readonly __typename: "Profile";
    readonly appearance: Appearance;
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
export type appearanceMutation = {
  response: appearanceMutation$data;
  variables: appearanceMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "appearance"
  },
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "expectedAppearance"
  }
],
v1 = [
  {
    "kind": "Variable",
    "name": "appearance",
    "variableName": "appearance"
  },
  {
    "kind": "Variable",
    "name": "expectedAppearance",
    "variableName": "expectedAppearance"
  }
],
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "__typename",
  "storageKey": null
},
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "appearance",
  "storageKey": null
},
v4 = {
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
};
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "appearanceMutation",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "updateMyAppearance",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v3/*:: as any*/)
            ],
            "type": "Profile",
            "abstractKey": null
          },
          (v4/*:: as any*/)
        ],
        "storageKey": null
      }
    ],
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "appearanceMutation",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "updateMyAppearance",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v3/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "id",
                "storageKey": null
              }
            ],
            "type": "Profile",
            "abstractKey": null
          },
          (v4/*:: as any*/)
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "ed1067b07c629bcb2b3c39b7511ccb75",
    "id": null,
    "metadata": {},
    "name": "appearanceMutation",
    "operationKind": "mutation",
    "text": "mutation appearanceMutation(\n  $appearance: Appearance!\n  $expectedAppearance: Appearance!\n) {\n  updateMyAppearance(appearance: $appearance, expectedAppearance: $expectedAppearance) {\n    __typename\n    ... on Profile {\n      appearance\n      id\n    }\n    ... on ProfileProblem {\n      code\n      message\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "1601155e601d2449630b0749a6d39351";

export default node;
