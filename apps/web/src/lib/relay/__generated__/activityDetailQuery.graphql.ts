/**
 * @generated SignedSource<<19bb37ae0b88abe0efe766c83f188bfd>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type Currency = "USD" | "%future added value";
export type activityDetailQuery$variables = {
  id: string;
};
export type activityDetailQuery$data = {
  readonly node: {
    readonly __typename: "Expense";
    readonly createdAt: string;
    readonly currency: Currency;
    readonly description: string;
    readonly effectiveDate: string;
    readonly groupId: string;
    readonly id: string;
    readonly payer: {
      readonly displayName: string;
    };
    readonly totalMinor: string;
  } | {
    readonly __typename: "Repayment";
    readonly amountMinor: string;
    readonly createdAt: string;
    readonly currency: Currency;
    readonly effectiveDate: string;
    readonly groupId: string;
    readonly id: string;
    readonly recipient: {
      readonly displayName: string;
    };
    readonly sender: {
      readonly displayName: string;
    };
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  } | null | undefined;
};
export type activityDetailQuery = {
  response: activityDetailQuery$data;
  variables: activityDetailQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "id"
  }
],
v1 = [
  {
    "kind": "Variable",
    "name": "id",
    "variableName": "id"
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
  "name": "id",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "groupId",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "description",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "totalMinor",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "currency",
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "effectiveDate",
  "storageKey": null
},
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "createdAt",
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "displayName",
  "storageKey": null
},
v11 = [
  (v10/*:: as any*/)
],
v12 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "amountMinor",
  "storageKey": null
},
v13 = [
  (v10/*:: as any*/),
  (v3/*:: as any*/)
];
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "activityDetailQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "node",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v3/*:: as any*/),
              (v4/*:: as any*/),
              (v5/*:: as any*/),
              (v6/*:: as any*/),
              (v7/*:: as any*/),
              (v8/*:: as any*/),
              (v9/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "Membership",
                "kind": "LinkedField",
                "name": "payer",
                "plural": false,
                "selections": (v11/*:: as any*/),
                "storageKey": null
              }
            ],
            "type": "Expense",
            "abstractKey": null
          },
          {
            "kind": "InlineFragment",
            "selections": [
              (v3/*:: as any*/),
              (v4/*:: as any*/),
              (v12/*:: as any*/),
              (v7/*:: as any*/),
              (v8/*:: as any*/),
              (v9/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "Membership",
                "kind": "LinkedField",
                "name": "sender",
                "plural": false,
                "selections": (v11/*:: as any*/),
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "concreteType": "Membership",
                "kind": "LinkedField",
                "name": "recipient",
                "plural": false,
                "selections": (v11/*:: as any*/),
                "storageKey": null
              }
            ],
            "type": "Repayment",
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
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "activityDetailQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "node",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          (v3/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v4/*:: as any*/),
              (v5/*:: as any*/),
              (v6/*:: as any*/),
              (v7/*:: as any*/),
              (v8/*:: as any*/),
              (v9/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "Membership",
                "kind": "LinkedField",
                "name": "payer",
                "plural": false,
                "selections": (v13/*:: as any*/),
                "storageKey": null
              }
            ],
            "type": "Expense",
            "abstractKey": null
          },
          {
            "kind": "InlineFragment",
            "selections": [
              (v4/*:: as any*/),
              (v12/*:: as any*/),
              (v7/*:: as any*/),
              (v8/*:: as any*/),
              (v9/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "Membership",
                "kind": "LinkedField",
                "name": "sender",
                "plural": false,
                "selections": (v13/*:: as any*/),
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "concreteType": "Membership",
                "kind": "LinkedField",
                "name": "recipient",
                "plural": false,
                "selections": (v13/*:: as any*/),
                "storageKey": null
              }
            ],
            "type": "Repayment",
            "abstractKey": null
          }
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "383a45c053714eebd78a84fa40e82f0e",
    "id": null,
    "metadata": {},
    "name": "activityDetailQuery",
    "operationKind": "query",
    "text": "query activityDetailQuery(\n  $id: ID!\n) {\n  node(id: $id) {\n    __typename\n    ... on Expense {\n      id\n      groupId\n      description\n      totalMinor\n      currency\n      effectiveDate\n      createdAt\n      payer {\n        displayName\n        id\n      }\n    }\n    ... on Repayment {\n      id\n      groupId\n      amountMinor\n      currency\n      effectiveDate\n      createdAt\n      sender {\n        displayName\n        id\n      }\n      recipient {\n        displayName\n        id\n      }\n    }\n    id\n  }\n}\n"
  }
};
})();

(node as any).hash = "b445c4d0f1f77079ed410c641f3c7319";

export default node;
