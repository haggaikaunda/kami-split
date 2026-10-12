/**
 * @generated SignedSource<<f4def22dc75a6c06ff7c6b86b6a3da64>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type Category = "ACCOMMODATION" | "ACTIVITIES" | "DINING" | "GROCERIES" | "HOME" | "OTHER" | "TRANSPORT" | "%future added value";
export type ExpenseSort = "AMOUNT_ASC" | "AMOUNT_DESC" | "DATE_ASC" | "DATE_DESC" | "%future added value";
export type StructuredExpenseFilter = {
  categories?: ReadonlyArray<Category> | null | undefined;
  category?: Category | null | undefined;
  from?: string | null | undefined;
  groupId?: string | null | undefined;
  memberId?: string | null | undefined;
  memberIds?: ReadonlyArray<string> | null | undefined;
  paidByIds?: ReadonlyArray<string> | null | undefined;
  sort?: ExpenseSort | null | undefined;
  to?: string | null | undefined;
};
export type expensesHouseholdQuery$variables = {
  after?: string | null | undefined;
  filter?: StructuredExpenseFilter | null | undefined;
};
export type expensesHouseholdQuery$data = {
  readonly householdExpenses: {
    readonly " $fragmentSpreads": FragmentRefs<"expensesView">;
  };
};
export type expensesHouseholdQuery = {
  response: expensesHouseholdQuery$data;
  variables: expensesHouseholdQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "after"
  },
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "filter"
  }
],
v1 = [
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
    "value": 6
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
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "contextVersion",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "totalExpenseMinor",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "viewerShareMinor",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "viewerPaidMinor",
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "category",
  "storageKey": null
},
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "expenseCount",
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "concreteType": "ExpenseCategoryTotal",
  "kind": "LinkedField",
  "name": "categories",
  "plural": true,
  "selections": [
    (v8/*:: as any*/),
    (v5/*:: as any*/),
    (v6/*:: as any*/),
    (v9/*:: as any*/)
  ],
  "storageKey": null
},
v11 = {
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
    (v5/*:: as any*/),
    (v9/*:: as any*/)
  ],
  "storageKey": null
},
v12 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "cursor",
  "storageKey": null
},
v13 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "name",
  "storageKey": null
},
v14 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "currency",
  "storageKey": null
},
v15 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v16 = {
  "alias": null,
  "args": null,
  "concreteType": "Expense",
  "kind": "LinkedField",
  "name": "node",
  "plural": false,
  "selections": [
    (v15/*:: as any*/),
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
    (v8/*:: as any*/),
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
        (v15/*:: as any*/),
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
            (v15/*:: as any*/)
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
v17 = {
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
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "expensesHouseholdQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "householdExpenses",
        "plural": false,
        "selections": [
          {
            "kind": "InlineDataFragmentSpread",
            "name": "expensesView",
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
                  (v10/*:: as any*/),
                  (v9/*:: as any*/),
                  (v11/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "ExpenseViewEdge",
                    "kind": "LinkedField",
                    "name": "edges",
                    "plural": true,
                    "selections": [
                      (v12/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "concreteType": "GroupSummary",
                        "kind": "LinkedField",
                        "name": "source",
                        "plural": false,
                        "selections": [
                          (v13/*:: as any*/),
                          (v14/*:: as any*/)
                        ],
                        "storageKey": null
                      },
                      (v16/*:: as any*/)
                    ],
                    "storageKey": null
                  },
                  (v17/*:: as any*/)
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
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "expensesHouseholdQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "householdExpenses",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          {
            "kind": "TypeDiscriminator",
            "abstractKey": "__isExpenseViewResult"
          },
          (v3/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v4/*:: as any*/),
              (v5/*:: as any*/),
              (v6/*:: as any*/),
              (v7/*:: as any*/),
              (v10/*:: as any*/),
              (v9/*:: as any*/),
              (v11/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "ExpenseViewEdge",
                "kind": "LinkedField",
                "name": "edges",
                "plural": true,
                "selections": [
                  (v12/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "GroupSummary",
                    "kind": "LinkedField",
                    "name": "source",
                    "plural": false,
                    "selections": [
                      (v13/*:: as any*/),
                      (v14/*:: as any*/),
                      (v15/*:: as any*/)
                    ],
                    "storageKey": null
                  },
                  (v16/*:: as any*/)
                ],
                "storageKey": null
              },
              (v17/*:: as any*/)
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
    "cacheID": "d28a52406d5ee858029a090aef3d20a1",
    "id": null,
    "metadata": {},
    "name": "expensesHouseholdQuery",
    "operationKind": "query",
    "text": "query expensesHouseholdQuery(\n  $after: String\n  $filter: StructuredExpenseFilter\n) {\n  householdExpenses(first: 6, after: $after, filter: $filter) {\n    __typename\n    ...expensesView\n  }\n}\n\nfragment expensesView on ExpenseViewResult {\n  __isExpenseViewResult: __typename\n  __typename\n  ... on Problem {\n    code\n  }\n  ... on ExpenseView {\n    contextVersion\n    totalExpenseMinor\n    viewerShareMinor\n    viewerPaidMinor\n    categories {\n      category\n      totalExpenseMinor\n      viewerShareMinor\n      expenseCount\n    }\n    expenseCount\n    months {\n      month\n      totalExpenseMinor\n      expenseCount\n    }\n    edges {\n      cursor\n      source {\n        name\n        currency\n        id\n      }\n      node {\n        id\n        groupId\n        description\n        effectiveDate\n        category\n        totalMinor\n        payer {\n          id\n          displayName\n        }\n        allocations {\n          participant {\n            id\n          }\n          amountMinor\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "461ebb4e6b1f38c0160b2efe57ee59f1";

export default node;
