/**
 * @generated SignedSource<<a4c978d802615d612e1fa8f72547fa9a>>
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
    "value": 6
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
  "name": "contextVersion",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "totalExpenseMinor",
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "viewerShareMinor",
  "storageKey": null
},
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "viewerPaidMinor",
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "category",
  "storageKey": null
},
v11 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "expenseCount",
  "storageKey": null
},
v12 = {
  "alias": null,
  "args": null,
  "concreteType": "ExpenseCategoryTotal",
  "kind": "LinkedField",
  "name": "categories",
  "plural": true,
  "selections": [
    (v10/*:: as any*/),
    (v7/*:: as any*/),
    (v8/*:: as any*/),
    (v11/*:: as any*/)
  ],
  "storageKey": null
},
v13 = {
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
    (v7/*:: as any*/),
    (v11/*:: as any*/)
  ],
  "storageKey": null
},
v14 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "cursor",
  "storageKey": null
},
v15 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "name",
  "storageKey": null
},
v16 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "currency",
  "storageKey": null
},
v17 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "expenseId",
  "storageKey": null
},
v18 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "groupId",
  "storageKey": null
},
v19 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "description",
  "storageKey": null
},
v20 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "effectiveDate",
  "storageKey": null
},
v21 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "totalMinor",
  "storageKey": null
},
v22 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v23 = {
  "alias": null,
  "args": null,
  "concreteType": "Membership",
  "kind": "LinkedField",
  "name": "payer",
  "plural": false,
  "selections": [
    (v22/*:: as any*/),
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
v24 = {
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
        (v22/*:: as any*/)
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
},
v25 = {
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
                  (v9/*:: as any*/),
                  (v12/*:: as any*/),
                  (v11/*:: as any*/),
                  (v13/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "ExpenseViewEdge",
                    "kind": "LinkedField",
                    "name": "edges",
                    "plural": true,
                    "selections": [
                      (v14/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "concreteType": "GroupSummary",
                        "kind": "LinkedField",
                        "name": "source",
                        "plural": false,
                        "selections": [
                          (v15/*:: as any*/),
                          (v16/*:: as any*/)
                        ],
                        "storageKey": null
                      },
                      {
                        "alias": "node",
                        "args": null,
                        "concreteType": "ExpenseSnapshot",
                        "kind": "LinkedField",
                        "name": "snapshot",
                        "plural": false,
                        "selections": [
                          (v17/*:: as any*/),
                          (v18/*:: as any*/),
                          (v19/*:: as any*/),
                          (v20/*:: as any*/),
                          (v10/*:: as any*/),
                          (v21/*:: as any*/),
                          (v23/*:: as any*/),
                          (v24/*:: as any*/)
                        ],
                        "storageKey": null
                      }
                    ],
                    "storageKey": null
                  },
                  (v25/*:: as any*/)
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
              (v9/*:: as any*/),
              (v12/*:: as any*/),
              (v11/*:: as any*/),
              (v13/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "ExpenseViewEdge",
                "kind": "LinkedField",
                "name": "edges",
                "plural": true,
                "selections": [
                  (v14/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "GroupSummary",
                    "kind": "LinkedField",
                    "name": "source",
                    "plural": false,
                    "selections": [
                      (v15/*:: as any*/),
                      (v16/*:: as any*/),
                      (v22/*:: as any*/)
                    ],
                    "storageKey": null
                  },
                  {
                    "alias": "node",
                    "args": null,
                    "concreteType": "ExpenseSnapshot",
                    "kind": "LinkedField",
                    "name": "snapshot",
                    "plural": false,
                    "selections": [
                      (v17/*:: as any*/),
                      (v18/*:: as any*/),
                      (v19/*:: as any*/),
                      (v20/*:: as any*/),
                      (v10/*:: as any*/),
                      (v21/*:: as any*/),
                      (v23/*:: as any*/),
                      (v24/*:: as any*/),
                      (v22/*:: as any*/)
                    ],
                    "storageKey": null
                  }
                ],
                "storageKey": null
              },
              (v25/*:: as any*/),
              (v22/*:: as any*/)
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
    "cacheID": "f9472b3da412c096c95df67761cd5994",
    "id": null,
    "metadata": {},
    "name": "expensesGroupQuery",
    "operationKind": "query",
    "text": "query expensesGroupQuery(\n  $groupId: ID!\n  $after: String\n  $filter: StructuredExpenseFilter\n) {\n  groupExpenses(groupId: $groupId, first: 6, after: $after, filter: $filter) {\n    __typename\n    ...expensesView\n    ... on ExpenseView {\n      id\n    }\n  }\n}\n\nfragment expensesView on ExpenseViewResult {\n  __isExpenseViewResult: __typename\n  __typename\n  ... on Problem {\n    code\n  }\n  ... on ExpenseView {\n    contextVersion\n    totalExpenseMinor\n    viewerShareMinor\n    viewerPaidMinor\n    categories {\n      category\n      totalExpenseMinor\n      viewerShareMinor\n      expenseCount\n    }\n    expenseCount\n    months {\n      month\n      totalExpenseMinor\n      expenseCount\n    }\n    edges {\n      cursor\n      source {\n        name\n        currency\n        id\n      }\n      node: snapshot {\n        expenseId\n        groupId\n        description\n        effectiveDate\n        category\n        totalMinor\n        payer {\n          id\n          displayName\n        }\n        allocations {\n          participant {\n            id\n          }\n          amountMinor\n        }\n        id\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "427fcccc7ce5eb11c4deb1f2eb00bf37";

export default node;
