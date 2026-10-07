/**
 * @generated SignedSource<<32c5d336cb68ab6ca399ba293a39b85a>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type Appearance = "DARK" | "LIGHT" | "SYSTEM" | "%future added value";
export type appearanceQuery$variables = Record<PropertyKey, never>;
export type appearanceQuery$data = {
  readonly currentProfile: {
    readonly __typename: "Profile";
    readonly appearance: Appearance;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
};
export type appearanceQuery = {
  response: appearanceQuery$data;
  variables: appearanceQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "__typename",
  "storageKey": null
},
v1 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "appearance",
  "storageKey": null
};
return {
  "fragment": {
    "argumentDefinitions": [],
    "kind": "Fragment",
    "metadata": null,
    "name": "appearanceQuery",
    "selections": [
      {
        "alias": null,
        "args": null,
        "concreteType": null,
        "kind": "LinkedField",
        "name": "currentProfile",
        "plural": false,
        "selections": [
          (v0/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v1/*:: as any*/)
            ],
            "type": "Profile",
            "abstractKey": null
          }
        ],
        "storageKey": null
      }
    ],
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "appearanceQuery",
    "selections": [
      {
        "alias": null,
        "args": null,
        "concreteType": null,
        "kind": "LinkedField",
        "name": "currentProfile",
        "plural": false,
        "selections": [
          (v0/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v1/*:: as any*/),
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
          }
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "c45bca1577c7eb25fd1e151b427ad6fb",
    "id": null,
    "metadata": {},
    "name": "appearanceQuery",
    "operationKind": "query",
    "text": "query appearanceQuery {\n  currentProfile {\n    __typename\n    ... on Profile {\n      appearance\n      id\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "0b2fc5a296bcffbc21783172f18ba16a";

export default node;
