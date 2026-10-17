/**
 * @generated SignedSource<<915a486cbbceba13a9c2a0b148656833>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type Category = "ACCOMMODATION" | "ACTIVITIES" | "DINING" | "GROCERIES" | "HOME" | "OTHER" | "TRANSPORT" | "%future added value";
export type Currency = "USD" | "%future added value";
export type GroupKind = "ORDINARY" | "TRIP" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
export type householdWorkspaceQuery$variables = {
  balances: boolean;
  recent: boolean;
};
export type householdWorkspaceQuery$data = {
  readonly householdDashboard: {
    readonly __typename: "HouseholdDashboard";
    readonly dashboard: {
      readonly " $fragmentSpreads": FragmentRefs<"householdContentDashboard">;
    } | null | undefined;
  } | {
    readonly __typename: "Problem";
    readonly code: ProblemCode;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
  readonly householdExpenses?: {
    readonly __typename: "ExpenseView";
    readonly edges: ReadonlyArray<{
      readonly node: {
        readonly allocations: ReadonlyArray<{
          readonly amountMinor: string;
          readonly participant: {
            readonly id: string;
          };
        }>;
        readonly category: Category;
        readonly description: string;
        readonly effectiveDate: string;
        readonly expenseId: string;
        readonly groupId: string;
        readonly totalMinor: string;
        readonly version: string;
      };
      readonly source: {
        readonly currency: Currency;
        readonly id: string;
        readonly isHousehold: boolean;
        readonly kind: GroupKind;
        readonly name: string;
      };
    }>;
  } | {
    readonly __typename: "Problem";
    readonly code: ProblemCode;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
};
export type householdWorkspaceQuery = {
  response: householdWorkspaceQuery$data;
  variables: householdWorkspaceQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "balances"
},
v1 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "recent"
},
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
v4 = [
  {
    "kind": "Literal",
    "name": "first",
    "value": 4
  }
],
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "expenseId",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "version",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "groupId",
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "description",
  "storageKey": null
},
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "effectiveDate",
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "totalMinor",
  "storageKey": null
},
v11 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "category",
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
  "kind": "ScalarField",
  "name": "amountMinor",
  "storageKey": null
},
v14 = {
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
    (v13/*:: as any*/)
  ],
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
  "name": "kind",
  "storageKey": null
},
v17 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "isHousehold",
  "storageKey": null
},
v18 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "currency",
  "storageKey": null
},
v19 = {
  "alias": null,
  "args": null,
  "concreteType": "GroupSummary",
  "kind": "LinkedField",
  "name": "source",
  "plural": false,
  "selections": [
    (v12/*:: as any*/),
    (v15/*:: as any*/),
    (v16/*:: as any*/),
    (v17/*:: as any*/),
    (v18/*:: as any*/)
  ],
  "storageKey": null
},
v20 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "viewerNetMinor",
  "storageKey": null
},
v21 = [
  (v12/*:: as any*/),
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "displayName",
    "storageKey": null
  },
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "canParticipate",
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "householdWorkspaceQuery",
    "selections": [
      {
        "alias": null,
        "args": null,
        "concreteType": null,
        "kind": "LinkedField",
        "name": "householdDashboard",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          (v3/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              {
                "fragment": {
                  "kind": "InlineFragment",
                  "selections": [
                    {
                      "args": [
                        {
                          "kind": "Variable",
                          "name": "balances",
                          "variableName": "balances"
                        }
                      ],
                      "kind": "FragmentSpread",
                      "name": "householdContentDashboard"
                    }
                  ],
                  "type": "HouseholdDashboard",
                  "abstractKey": null
                },
                "kind": "AliasedInlineFragmentSpread",
                "name": "dashboard"
              }
            ],
            "type": "HouseholdDashboard",
            "abstractKey": null
          }
        ],
        "storageKey": null
      },
      {
        "condition": "recent",
        "kind": "Condition",
        "passingValue": true,
        "selections": [
          {
            "alias": null,
            "args": (v4/*:: as any*/),
            "concreteType": null,
            "kind": "LinkedField",
            "name": "householdExpenses",
            "plural": false,
            "selections": [
              (v2/*:: as any*/),
              (v3/*:: as any*/),
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
                        "selections": [
                          (v5/*:: as any*/),
                          (v6/*:: as any*/),
                          (v7/*:: as any*/),
                          (v8/*:: as any*/),
                          (v9/*:: as any*/),
                          (v10/*:: as any*/),
                          (v11/*:: as any*/),
                          (v14/*:: as any*/)
                        ],
                        "storageKey": null
                      },
                      (v19/*:: as any*/)
                    ],
                    "storageKey": null
                  }
                ],
                "type": "ExpenseView",
                "abstractKey": null
              }
            ],
            "storageKey": "householdExpenses(first:4)"
          }
        ]
      }
    ],
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [
      (v1/*:: as any*/),
      (v0/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "householdWorkspaceQuery",
    "selections": [
      {
        "alias": null,
        "args": null,
        "concreteType": null,
        "kind": "LinkedField",
        "name": "householdDashboard",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          (v3/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
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
                      {
                        "alias": null,
                        "args": null,
                        "kind": "ScalarField",
                        "name": "viewerShareMinor",
                        "storageKey": null
                      },
                      {
                        "alias": null,
                        "args": null,
                        "kind": "ScalarField",
                        "name": "viewerPaidMinor",
                        "storageKey": null
                      },
                      (v20/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "kind": "ScalarField",
                        "name": "openBalanceCount",
                        "storageKey": null
                      },
                      {
                        "alias": null,
                        "args": null,
                        "kind": "ScalarField",
                        "name": "activeSpaceCount",
                        "storageKey": null
                      },
                      {
                        "alias": null,
                        "args": null,
                        "kind": "ScalarField",
                        "name": "totalSharedExpenseMinor",
                        "storageKey": null
                      },
                      {
                        "alias": null,
                        "args": null,
                        "kind": "ScalarField",
                        "name": "totalSharedExpenseCount",
                        "storageKey": null
                      }
                    ],
                    "type": "HouseholdDashboardTotals",
                    "abstractKey": null
                  },
                  (v3/*:: as any*/)
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
                  (v7/*:: as any*/),
                  (v15/*:: as any*/),
                  (v16/*:: as any*/),
                  (v17/*:: as any*/),
                  (v18/*:: as any*/),
                  (v20/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "sharedExpenseCount",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "Membership",
                    "kind": "LinkedField",
                    "name": "viewerMembership",
                    "plural": false,
                    "selections": [
                      (v12/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "kind": "ScalarField",
                        "name": "role",
                        "storageKey": null
                      }
                    ],
                    "storageKey": null
                  },
                  {
                    "condition": "balances",
                    "kind": "Condition",
                    "passingValue": true,
                    "selections": [
                      {
                        "alias": null,
                        "args": null,
                        "concreteType": null,
                        "kind": "LinkedField",
                        "name": "balances",
                        "plural": false,
                        "selections": [
                          (v2/*:: as any*/),
                          {
                            "kind": "InlineFragment",
                            "selections": [
                              {
                                "alias": null,
                                "args": null,
                                "kind": "ScalarField",
                                "name": "settled",
                                "storageKey": null
                              },
                              {
                                "alias": null,
                                "args": null,
                                "concreteType": "Obligation",
                                "kind": "LinkedField",
                                "name": "obligations",
                                "plural": true,
                                "selections": [
                                  {
                                    "alias": null,
                                    "args": null,
                                    "concreteType": "Membership",
                                    "kind": "LinkedField",
                                    "name": "from",
                                    "plural": false,
                                    "selections": (v21/*:: as any*/),
                                    "storageKey": null
                                  },
                                  {
                                    "alias": null,
                                    "args": null,
                                    "concreteType": "Membership",
                                    "kind": "LinkedField",
                                    "name": "to",
                                    "plural": false,
                                    "selections": (v21/*:: as any*/),
                                    "storageKey": null
                                  },
                                  (v13/*:: as any*/)
                                ],
                                "storageKey": null
                              }
                            ],
                            "type": "GroupBalances",
                            "abstractKey": null
                          },
                          (v3/*:: as any*/)
                        ],
                        "storageKey": null
                      }
                    ]
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
      },
      {
        "condition": "recent",
        "kind": "Condition",
        "passingValue": true,
        "selections": [
          {
            "alias": null,
            "args": (v4/*:: as any*/),
            "concreteType": null,
            "kind": "LinkedField",
            "name": "householdExpenses",
            "plural": false,
            "selections": [
              (v2/*:: as any*/),
              (v3/*:: as any*/),
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
                        "selections": [
                          (v5/*:: as any*/),
                          (v6/*:: as any*/),
                          (v7/*:: as any*/),
                          (v8/*:: as any*/),
                          (v9/*:: as any*/),
                          (v10/*:: as any*/),
                          (v11/*:: as any*/),
                          (v14/*:: as any*/),
                          (v12/*:: as any*/)
                        ],
                        "storageKey": null
                      },
                      (v19/*:: as any*/)
                    ],
                    "storageKey": null
                  },
                  (v12/*:: as any*/)
                ],
                "type": "ExpenseView",
                "abstractKey": null
              }
            ],
            "storageKey": "householdExpenses(first:4)"
          }
        ]
      }
    ]
  },
  "params": {
    "cacheID": "bb41574e576a1cd17e287da0f29c87b9",
    "id": null,
    "metadata": {},
    "name": "householdWorkspaceQuery",
    "operationKind": "query",
    "text": "query householdWorkspaceQuery(\n  $recent: Boolean!\n  $balances: Boolean!\n) {\n  householdDashboard {\n    __typename\n    ... on Problem {\n      code\n    }\n    ... on HouseholdDashboard {\n      ...householdContentDashboard_4qorL8\n    }\n  }\n  householdExpenses(first: 4) @include(if: $recent) {\n    __typename\n    ... on Problem {\n      code\n    }\n    ... on ExpenseView {\n      edges {\n        node: snapshot {\n          expenseId\n          version\n          groupId\n          description\n          effectiveDate\n          totalMinor\n          category\n          allocations {\n            participant {\n              id\n            }\n            amountMinor\n          }\n          id\n        }\n        source {\n          id\n          name\n          kind\n          isHousehold\n          currency\n        }\n      }\n      id\n    }\n  }\n}\n\nfragment householdContentDashboard_4qorL8 on HouseholdDashboard {\n  state\n  totals {\n    __typename\n    ... on HouseholdDashboardTotals {\n      viewerShareMinor\n      viewerPaidMinor\n      viewerNetMinor\n      openBalanceCount\n      activeSpaceCount\n      totalSharedExpenseMinor\n      totalSharedExpenseCount\n    }\n    ... on Problem {\n      code\n    }\n  }\n  spaces {\n    groupId\n    name\n    kind\n    isHousehold\n    currency\n    viewerNetMinor\n    sharedExpenseCount\n    viewerMembership {\n      id\n      role\n    }\n    balances @include(if: $balances) {\n      __typename\n      ... on GroupBalances {\n        settled\n        obligations {\n          from {\n            id\n            displayName\n            canParticipate\n          }\n          to {\n            id\n            displayName\n            canParticipate\n          }\n          amountMinor\n        }\n      }\n      ... on Problem {\n        code\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "eb147dbef8df3b43f4e3e47e8e861582";

export default node;
