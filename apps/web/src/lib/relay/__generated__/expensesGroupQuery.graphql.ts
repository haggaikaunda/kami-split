/**
 * @generated SignedSource<<0771e53e278db094dd2d1d7b428c3b80>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type Category = "ACCOMMODATION" | "ACTIVITIES" | "DINING" | "GROCERIES" | "HOME" | "OTHER" | "TRANSPORT" | "%future added value";
export type StructuredExpenseFilter = {
  category?: Category | null | undefined;
  from?: string | null | undefined;
  groupId?: string | null | undefined;
  memberId?: string | null | undefined;
  to?: string | null | undefined;
};
export type expensesGroupQuery$variables = {
  after?: string | null | undefined;
  filter?: StructuredExpenseFilter | null | undefined;
  groupId: string;
};
export type expensesGroupQuery$data = {
  readonly groupExpenses: {
    readonly " $fragmentSpreads": FragmentRefs<"expensesView">;
  };
};
export type expensesGroupQuery = {
  response: expensesGroupQuery$data;
  variables: expensesGroupQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "after"
},
v1 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "filter"
},
v2 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "groupId"
},
v3 = [
  {
    "kind": "Variable",
    "name": "after",
    "variableName": "after"
  },
  {
    "kind": "Variable",
    "name": "filter",
    "variableName": "filter"
  },
  {
    "kind": "Literal",
    "name": "first",
    "value": 20
  },
  {
    "kind": "Variable",
    "name": "groupId",
    "variableName": "groupId"
  }
],
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "__typename",
  "storageKey": null
},
v5 = {
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
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "totalExpenseMinor",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "expenseCount",
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "concreteType": "ExpenseMonth",
  "kind": "LinkedField",
  "name": "months",
  "plural": true,
  "selections": [
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "month",
      "storageKey": null
    },
    (v6/*:: as any*/),
    (v7/*:: as any*/)
  ],
  "storageKey": null
},
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "cursor",
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "name",
  "storageKey": null
},
v11 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "currency",
  "storageKey": null
},
v12 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v13 = {
  "alias": null,
  "args": null,
  "concreteType": "Expense",
  "kind": "LinkedField",
  "name": "node",
  "plural": false,
  "selections": [
    (v12/*:: as any*/),
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
      "name": "description",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "effectiveDate",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "category",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "totalMinor",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "concreteType": "Membership",
      "kind": "LinkedField",
      "name": "payer",
      "plural": false,
      "selections": [
        (v12/*:: as any*/),
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "displayName",
          "storageKey": null
        }
      ],
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "concreteType": "Allocation",
      "kind": "LinkedField",
      "name": "allocations",
      "plural": true,
      "selections": [
        {
          "alias": null,
          "args": null,
          "concreteType": "Membership",
          "kind": "LinkedField",
          "name": "participant",
          "plural": false,
          "selections": [
            (v12/*:: as any*/)
          ],
          "storageKey": null
        },
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "amountMinor",
          "storageKey": null
        }
      ],
      "storageKey": null
    }
  ],
  "storageKey": null
},
v14 = {
  "alias": null,
  "args": null,
  "concreteType": "PageInfo",
  "kind": "LinkedField",
  "name": "pageInfo",
  "plural": false,
  "selections": [
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "hasNextPage",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "endCursor",
      "storageKey": null
    }
  ],
  "storageKey": null
};
return {
  "fragment": {
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/),
      (v2/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "expensesGroupQuery",
    "selections": [
      {
        "alias": null,
        "args": (v3/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "groupExpenses",
        "plural": false,
        "selections": [
          {
            "kind": "InlineDataFragmentSpread",
            "name": "expensesView",
            "selections": [
              (v4/*:: as any*/),
              (v5/*:: as any*/),
              {
                "kind": "InlineFragment",
                "selections": [
                  (v6/*:: as any*/),
                  (v7/*:: as any*/),
                  (v8/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "ExpenseViewEdge",
                    "kind": "LinkedField",
                    "name": "edges",
                    "plural": true,
                    "selections": [
                      (v9/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "concreteType": "GroupSummary",
                        "kind": "LinkedField",
                        "name": "source",
                        "plural": false,
                        "selections": [
                          (v10/*:: as any*/),
                          (v11/*:: as any*/)
                        ],
                        "storageKey": null
                      },
                      (v13/*:: as any*/)
                    ],
                    "storageKey": null
                  },
                  (v14/*:: as any*/)
                ],
                "type": "ExpenseView",
                "abstractKey": null
              }
            ],
            "args": null,
            "argumentDefinitions": []
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
    "argumentDefinitions": [
      (v2/*:: as any*/),
      (v0/*:: as any*/),
      (v1/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "expensesGroupQuery",
    "selections": [
      {
        "alias": null,
        "args": (v3/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "groupExpenses",
        "plural": false,
        "selections": [
          (v4/*:: as any*/),
          {
            "kind": "TypeDiscriminator",
            "abstractKey": "__isExpenseViewResult"
          },
          (v5/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v6/*:: as any*/),
              (v7/*:: as any*/),
              (v8/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "ExpenseViewEdge",
                "kind": "LinkedField",
                "name": "edges",
                "plural": true,
                "selections": [
                  (v9/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "GroupSummary",
                    "kind": "LinkedField",
                    "name": "source",
                    "plural": false,
                    "selections": [
                      (v10/*:: as any*/),
                      (v11/*:: as any*/),
                      (v12/*:: as any*/)
                    ],
                    "storageKey": null
                  },
                  (v13/*:: as any*/)
                ],
                "storageKey": null
              },
              (v14/*:: as any*/)
            ],
            "type": "ExpenseView",
            "abstractKey": null
          }
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "d6c4f72e27e765e673f59ad234c41fe1",
    "id": null,
    "metadata": {},
    "name": "expensesGroupQuery",
    "operationKind": "query",
    "text": "query expensesGroupQuery(\n  $groupId: ID!\n  $after: String\n  $filter: StructuredExpenseFilter\n) {\n  groupExpenses(groupId: $groupId, first: 20, after: $after, filter: $filter) {\n    __typename\n    ...expensesView\n  }\n}\n\nfragment expensesView on ExpenseViewResult {\n  __isExpenseViewResult: __typename\n  __typename\n  ... on Problem {\n    code\n  }\n  ... on ExpenseView {\n    totalExpenseMinor\n    expenseCount\n    months {\n      month\n      totalExpenseMinor\n      expenseCount\n    }\n    edges {\n      cursor\n      source {\n        name\n        currency\n        id\n      }\n      node {\n        id\n        groupId\n        description\n        effectiveDate\n        category\n        totalMinor\n        payer {\n          id\n          displayName\n        }\n        allocations {\n          participant {\n            id\n          }\n          amountMinor\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "0492898620bb4e19bf932b2be7892f3a";

export default node;
