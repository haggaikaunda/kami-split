/**
 * @generated SignedSource<<b93cb5842ad44480e5cf51b9fb52598c>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type Category = "ACCOMMODATION" | "ACTIVITIES" | "DINING" | "GROCERIES" | "HOME" | "OTHER" | "TRANSPORT" | "%future added value";
export type Currency = "USD" | "%future added value";
export type HouseholdDashboardState = "COMPLETE" | "INCOMPLETE" | "UNAVAILABLE" | "%future added value";
export type MembershipRole = "MEMBER" | "OWNER" | "%future added value";
export type MembershipStatus = "ACTIVE" | "INACTIVE" | "%future added value";
export type StructuredExpenseFilter = {
  category?: Category | null | undefined;
  from?: string | null | undefined;
  groupId?: string | null | undefined;
  memberId?: string | null | undefined;
  to?: string | null | undefined;
};
export type expensesHouseholdInitialQuery$variables = {
  filter?: StructuredExpenseFilter | null | undefined;
};
export type expensesHouseholdInitialQuery$data = {
  readonly householdDashboard: {
    readonly __typename: "HouseholdDashboard";
    readonly contextVersion: string | null | undefined;
    readonly spaces: ReadonlyArray<{
      readonly currency: Currency;
      readonly groupId: string;
      readonly isHousehold: boolean;
      readonly members: ReadonlyArray<{
        readonly canParticipate: boolean;
        readonly displayName: string;
        readonly id: string;
        readonly role: MembershipRole;
        readonly status: MembershipStatus;
      }>;
      readonly name: string;
      readonly viewerMembership: {
        readonly id: string;
      };
      readonly viewerNetMinor: string | null | undefined;
    }>;
    readonly state: HouseholdDashboardState;
    readonly totals: {
      readonly __typename: "HouseholdDashboardTotals";
      readonly activeSpaceCount: string;
      readonly viewerNetMinor: string;
    } | {
      // This will never be '%other', but we need some
      // value in case none of the concrete values match.
      readonly __typename: "%other";
    } | null | undefined;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
  readonly householdExpenses: {
    readonly " $fragmentSpreads": FragmentRefs<"expensesView">;
  };
  readonly viewer: {
    readonly __typename: "Viewer";
    readonly today: string;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
};
export type expensesHouseholdInitialQuery = {
  response: expensesHouseholdInitialQuery$data;
  variables: expensesHouseholdInitialQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "filter"
  }
],
v1 = [
  {
    "kind": "Variable",
    "name": "filter",
    "variableName": "filter"
  },
  {
    "kind": "Literal",
    "name": "first",
    "value": 20
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
  "name": "expenseCount",
  "storageKey": null
},
v7 = {
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
    (v6/*:: as any*/)
  ],
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "cursor",
  "storageKey": null
},
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "name",
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "currency",
  "storageKey": null
},
v11 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v12 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "groupId",
  "storageKey": null
},
v13 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "displayName",
  "storageKey": null
},
v14 = [
  (v11/*:: as any*/)
],
v15 = {
  "alias": null,
  "args": null,
  "concreteType": "Expense",
  "kind": "LinkedField",
  "name": "node",
  "plural": false,
  "selections": [
    (v11/*:: as any*/),
    (v12/*:: as any*/),
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
        (v11/*:: as any*/),
        (v13/*:: as any*/)
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
          "selections": (v14/*:: as any*/),
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
v16 = {
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
},
v17 = {
  "kind": "InlineFragment",
  "selections": [
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "today",
      "storageKey": null
    }
  ],
  "type": "Viewer",
  "abstractKey": null
},
v18 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "viewerNetMinor",
  "storageKey": null
},
v19 = {
  "alias": null,
  "args": null,
  "concreteType": null,
  "kind": "LinkedField",
  "name": "householdDashboard",
  "plural": false,
  "selections": [
    (v2/*:: as any*/),
    {
      "kind": "InlineFragment",
      "selections": [
        (v4/*:: as any*/),
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
          "concreteType": null,
          "kind": "LinkedField",
          "name": "totals",
          "plural": false,
          "selections": [
            (v2/*:: as any*/),
            {
              "kind": "InlineFragment",
              "selections": [
                (v18/*:: as any*/),
                {
                  "alias": null,
                  "args": null,
                  "kind": "ScalarField",
                  "name": "activeSpaceCount",
                  "storageKey": null
                }
              ],
              "type": "HouseholdDashboardTotals",
              "abstractKey": null
            }
          ],
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
            (v12/*:: as any*/),
            (v9/*:: as any*/),
            (v10/*:: as any*/),
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "isHousehold",
              "storageKey": null
            },
            (v18/*:: as any*/),
            {
              "alias": null,
              "args": null,
              "concreteType": "Membership",
              "kind": "LinkedField",
              "name": "viewerMembership",
              "plural": false,
              "selections": (v14/*:: as any*/),
              "storageKey": null
            },
            {
              "alias": null,
              "args": null,
              "concreteType": "Membership",
              "kind": "LinkedField",
              "name": "members",
              "plural": true,
              "selections": [
                (v11/*:: as any*/),
                (v13/*:: as any*/),
                {
                  "alias": null,
                  "args": null,
                  "kind": "ScalarField",
                  "name": "status",
                  "storageKey": null
                },
                {
                  "alias": null,
                  "args": null,
                  "kind": "ScalarField",
                  "name": "role",
                  "storageKey": null
                },
                {
                  "alias": null,
                  "args": null,
                  "kind": "ScalarField",
                  "name": "canParticipate",
                  "storageKey": null
                }
              ],
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
};
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "expensesHouseholdInitialQuery",
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
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "ExpenseViewEdge",
                    "kind": "LinkedField",
                    "name": "edges",
                    "plural": true,
                    "selections": [
                      (v8/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "concreteType": "GroupSummary",
                        "kind": "LinkedField",
                        "name": "source",
                        "plural": false,
                        "selections": [
                          (v9/*:: as any*/),
                          (v10/*:: as any*/)
                        ],
                        "storageKey": null
                      },
                      (v15/*:: as any*/)
                    ],
                    "storageKey": null
                  },
                  (v16/*:: as any*/)
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
      },
      {
        "alias": null,
        "args": null,
        "concreteType": null,
        "kind": "LinkedField",
        "name": "viewer",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          (v17/*:: as any*/)
        ],
        "storageKey": null
      },
      (v19/*:: as any*/)
    ],
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "expensesHouseholdInitialQuery",
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
              {
                "alias": null,
                "args": null,
                "concreteType": "ExpenseViewEdge",
                "kind": "LinkedField",
                "name": "edges",
                "plural": true,
                "selections": [
                  (v8/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "GroupSummary",
                    "kind": "LinkedField",
                    "name": "source",
                    "plural": false,
                    "selections": [
                      (v9/*:: as any*/),
                      (v10/*:: as any*/),
                      (v11/*:: as any*/)
                    ],
                    "storageKey": null
                  },
                  (v15/*:: as any*/)
                ],
                "storageKey": null
              },
              (v16/*:: as any*/)
            ],
            "type": "ExpenseView",
            "abstractKey": null
          }
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": null,
        "kind": "LinkedField",
        "name": "viewer",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          (v17/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": (v14/*:: as any*/),
            "type": "Node",
            "abstractKey": "__isNode"
          }
        ],
        "storageKey": null
      },
      (v19/*:: as any*/)
    ]
  },
  "params": {
    "cacheID": "14ce516fe3a5ed80c600f5bf2a122004",
    "id": null,
    "metadata": {},
    "name": "expensesHouseholdInitialQuery",
    "operationKind": "query",
    "text": "query expensesHouseholdInitialQuery(\n  $filter: StructuredExpenseFilter\n) {\n  householdExpenses(first: 20, filter: $filter) {\n    __typename\n    ...expensesView\n  }\n  viewer {\n    __typename\n    ... on Viewer {\n      today\n    }\n    ... on Node {\n      __isNode: __typename\n      id\n    }\n  }\n  householdDashboard {\n    __typename\n    ... on HouseholdDashboard {\n      contextVersion\n      state\n      totals {\n        __typename\n        ... on HouseholdDashboardTotals {\n          viewerNetMinor\n          activeSpaceCount\n        }\n      }\n      spaces {\n        groupId\n        name\n        currency\n        isHousehold\n        viewerNetMinor\n        viewerMembership {\n          id\n        }\n        members {\n          id\n          displayName\n          status\n          role\n          canParticipate\n        }\n      }\n    }\n  }\n}\n\nfragment expensesView on ExpenseViewResult {\n  __isExpenseViewResult: __typename\n  __typename\n  ... on Problem {\n    code\n  }\n  ... on ExpenseView {\n    contextVersion\n    totalExpenseMinor\n    expenseCount\n    months {\n      month\n      totalExpenseMinor\n      expenseCount\n    }\n    edges {\n      cursor\n      source {\n        name\n        currency\n        id\n      }\n      node {\n        id\n        groupId\n        description\n        effectiveDate\n        category\n        totalMinor\n        payer {\n          id\n          displayName\n        }\n        allocations {\n          participant {\n            id\n          }\n          amountMinor\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "54ec42b52c8db0ec1a5d706504646dcf";

export default node;
