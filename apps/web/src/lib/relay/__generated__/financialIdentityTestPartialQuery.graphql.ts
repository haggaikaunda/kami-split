/**
 * @generated SignedSource<<34d2a02362509198d2beb4bbea6cee8c>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type financialIdentityTestPartialQuery$variables = {
  groupId: string;
};
export type financialIdentityTestPartialQuery$data = {
  readonly group: {
    readonly expenses?: {
      readonly edges: ReadonlyArray<{
        readonly snapshot: {
          readonly expenseId: string;
          readonly totalMinor: string;
        };
      }>;
    } | null | undefined;
  };
  readonly groupExpenses: {
    readonly edges?: ReadonlyArray<{
      readonly node: {
        readonly expenseId: string;
        readonly totalMinor: string;
      };
    }>;
  };
};
export type financialIdentityTestPartialQuery = {
  response: financialIdentityTestPartialQuery$data;
  variables: financialIdentityTestPartialQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "groupId"
  }
],
v1 = [
  {
    "kind": "Literal",
    "name": "first",
    "value": 6
  },
  {
    "kind": "Variable",
    "name": "groupId",
    "variableName": "groupId"
  }
],
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "expenseId",
  "storageKey": null
},
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "totalMinor",
  "storageKey": null
},
v4 = [
  (v2/*:: as any*/),
  (v3/*:: as any*/)
],
v5 = [
  {
    "kind": "Variable",
    "name": "id",
    "variableName": "groupId"
  }
],
v6 = [
  {
    "kind": "Literal",
    "name": "first",
    "value": 20
  }
],
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "__typename",
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v9 = [
  (v2/*:: as any*/),
  (v3/*:: as any*/),
  (v8/*:: as any*/)
];
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "financialIdentityTestPartialQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "groupExpenses",
        "plural": false,
        "selections": [
          {
            "kind": "InlineFragment",
            "selections": [
              {
                "alias": null,
                "args": null,
                "concreteType": "ExpenseViewEdge",
                "kind": "LinkedField",
                "name": "edges",
                "plural": true,
                "selections": [
                  {
                    "alias": "node",
                    "args": null,
                    "concreteType": "ExpenseSnapshot",
                    "kind": "LinkedField",
                    "name": "snapshot",
                    "plural": false,
                    "selections": (v4/*:: as any*/),
                    "storageKey": null
                  }
                ],
                "storageKey": null
              }
            ],
            "type": "ExpenseView",
            "abstractKey": null
          }
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": (v5/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "group",
        "plural": false,
        "selections": [
          {
            "kind": "InlineFragment",
            "selections": [
              {
                "alias": null,
                "args": (v6/*:: as any*/),
                "concreteType": "ExpenseConnection",
                "kind": "LinkedField",
                "name": "expenses",
                "plural": false,
                "selections": [
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "ExpenseEdge",
                    "kind": "LinkedField",
                    "name": "edges",
                    "plural": true,
                    "selections": [
                      {
                        "alias": null,
                        "args": null,
                        "concreteType": "ExpenseSnapshot",
                        "kind": "LinkedField",
                        "name": "snapshot",
                        "plural": false,
                        "selections": (v4/*:: as any*/),
                        "storageKey": null
                      }
                    ],
                    "storageKey": null
                  }
                ],
                "storageKey": "expenses(first:20)"
              }
            ],
            "type": "Group",
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
    "name": "financialIdentityTestPartialQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "groupExpenses",
        "plural": false,
        "selections": [
          (v7/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              {
                "alias": null,
                "args": null,
                "concreteType": "ExpenseViewEdge",
                "kind": "LinkedField",
                "name": "edges",
                "plural": true,
                "selections": [
                  {
                    "alias": "node",
                    "args": null,
                    "concreteType": "ExpenseSnapshot",
                    "kind": "LinkedField",
                    "name": "snapshot",
                    "plural": false,
                    "selections": (v9/*:: as any*/),
                    "storageKey": null
                  }
                ],
                "storageKey": null
              },
              (v8/*:: as any*/)
            ],
            "type": "ExpenseView",
            "abstractKey": null
          }
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": (v5/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "group",
        "plural": false,
        "selections": [
          (v7/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              {
                "alias": null,
                "args": (v6/*:: as any*/),
                "concreteType": "ExpenseConnection",
                "kind": "LinkedField",
                "name": "expenses",
                "plural": false,
                "selections": [
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "ExpenseEdge",
                    "kind": "LinkedField",
                    "name": "edges",
                    "plural": true,
                    "selections": [
                      {
                        "alias": null,
                        "args": null,
                        "concreteType": "ExpenseSnapshot",
                        "kind": "LinkedField",
                        "name": "snapshot",
                        "plural": false,
                        "selections": (v9/*:: as any*/),
                        "storageKey": null
                      }
                    ],
                    "storageKey": null
                  },
                  (v8/*:: as any*/)
                ],
                "storageKey": "expenses(first:20)"
              }
            ],
            "type": "Group",
            "abstractKey": null
          },
          {
            "kind": "InlineFragment",
            "selections": [
              (v8/*:: as any*/)
            ],
            "type": "Node",
            "abstractKey": "__isNode"
          }
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "6621da6e17f9ccd42fbd92bc0dec46b6",
    "id": null,
    "metadata": {},
    "name": "financialIdentityTestPartialQuery",
    "operationKind": "query",
    "text": "query financialIdentityTestPartialQuery(\n  $groupId: ID!\n) {\n  groupExpenses(groupId: $groupId, first: 6) {\n    __typename\n    ... on ExpenseView {\n      edges {\n        node: snapshot {\n          expenseId\n          totalMinor\n          id\n        }\n      }\n      id\n    }\n  }\n  group(id: $groupId) {\n    __typename\n    ... on Group {\n      expenses(first: 20) {\n        edges {\n          snapshot {\n            expenseId\n            totalMinor\n            id\n          }\n        }\n        id\n      }\n    }\n    ... on Node {\n      __isNode: __typename\n      id\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "be6c8a040ada0dee2ffa397ca96047fd";

export default node;
