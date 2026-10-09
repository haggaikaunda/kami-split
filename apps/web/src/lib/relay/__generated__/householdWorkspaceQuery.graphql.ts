/**
 * @generated SignedSource<<a3c62732e43e0ec17c577ceac0c28822>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type Category = "ACCOMMODATION" | "ACTIVITIES" | "DINING" | "GROCERIES" | "HOME" | "OTHER" | "TRANSPORT" | "%future added value";
export type Currency = "USD" | "%future added value";
export type GroupKind = "ORDINARY" | "TRIP" | "%future added value";
export type HouseholdDashboardState = "COMPLETE" | "INCOMPLETE" | "UNAVAILABLE" | "%future added value";
export type MembershipRole = "MEMBER" | "OWNER" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
export type householdWorkspaceQuery$variables = {
  balances: boolean;
  recent: boolean;
};
export type householdWorkspaceQuery$data = {
  readonly householdDashboard: {
    readonly __typename: "HouseholdDashboard";
    readonly spaces: ReadonlyArray<{
      readonly balances?: {
        readonly __typename: "GroupBalances";
        readonly obligations: ReadonlyArray<{
          readonly amountMinor: string;
          readonly from: {
            readonly displayName: string;
            readonly id: string;
          };
          readonly to: {
            readonly displayName: string;
            readonly id: string;
          };
        }>;
        readonly settled: boolean;
      } | {
        readonly __typename: "Problem";
        readonly code: ProblemCode;
      } | {
        // This will never be '%other', but we need some
        // value in case none of the concrete values match.
        readonly __typename: "%other";
      };
      readonly currency: Currency;
      readonly groupId: string;
      readonly isHousehold: boolean;
      readonly kind: GroupKind;
      readonly name: string;
      readonly sharedExpenseCount: string;
      readonly viewerMembership: {
        readonly id: string;
        readonly role: MembershipRole;
      };
      readonly viewerNetMinor: string | null | undefined;
    }>;
    readonly state: HouseholdDashboardState;
    readonly totals: {
      readonly __typename: "HouseholdDashboardTotals";
      readonly activeSpaceCount: string;
      readonly openBalanceCount: string;
      readonly totalSharedExpenseCount: string;
      readonly totalSharedExpenseMinor: string;
      readonly viewerNetMinor: string;
      readonly viewerPaidMinor: string;
      readonly viewerShareMinor: string;
    } | {
      readonly __typename: "Problem";
      readonly code: ProblemCode;
    } | {
      // This will never be '%other', but we need some
      // value in case none of the concrete values match.
      readonly __typename: "%other";
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
        readonly category: Category;
        readonly description: string;
        readonly effectiveDate: string;
        readonly groupId: string;
        readonly id: string;
        readonly totalMinor: string;
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
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "viewerNetMinor",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "groupId",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "name",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "kind",
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "isHousehold",
  "storageKey": null
},
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "currency",
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v11 = [
  (v10/*:: as any*/),
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "displayName",
    "storageKey": null
  }
],
v12 = [
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
                  (v4/*:: as any*/),
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
              (v5/*:: as any*/),
              (v6/*:: as any*/),
              (v7/*:: as any*/),
              (v8/*:: as any*/),
              (v9/*:: as any*/),
              (v4/*:: as any*/),
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
                  (v10/*:: as any*/),
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
                                "selections": (v11/*:: as any*/),
                                "storageKey": null
                              },
                              {
                                "alias": null,
                                "args": null,
                                "concreteType": "Membership",
                                "kind": "LinkedField",
                                "name": "to",
                                "plural": false,
                                "selections": (v11/*:: as any*/),
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
        "args": [
          {
            "kind": "Literal",
            "name": "first",
            "value": 5
          }
        ],
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
                    "alias": null,
                    "args": null,
                    "concreteType": "Expense",
                    "kind": "LinkedField",
                    "name": "node",
                    "plural": false,
                    "selections": [
                      (v10/*:: as any*/),
                      (v5/*:: as any*/),
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
                        "name": "totalMinor",
                        "storageKey": null
                      },
                      {
                        "alias": null,
                        "args": null,
                        "kind": "ScalarField",
                        "name": "category",
                        "storageKey": null
                      }
                    ],
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "GroupSummary",
                    "kind": "LinkedField",
                    "name": "source",
                    "plural": false,
                    "selections": [
                      (v10/*:: as any*/),
                      (v6/*:: as any*/),
                      (v7/*:: as any*/),
                      (v8/*:: as any*/),
                      (v9/*:: as any*/)
                    ],
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
        "storageKey": "householdExpenses(first:5)"
      }
    ]
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
    "selections": (v12/*:: as any*/),
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
    "selections": (v12/*:: as any*/)
  },
  "params": {
    "cacheID": "caac144a4c89d657577f30d553a45899",
    "id": null,
    "metadata": {},
    "name": "householdWorkspaceQuery",
    "operationKind": "query",
    "text": "query householdWorkspaceQuery(\n  $recent: Boolean!\n  $balances: Boolean!\n) {\n  householdDashboard {\n    __typename\n    ... on Problem {\n      code\n    }\n    ... on HouseholdDashboard {\n      state\n      totals {\n        __typename\n        ... on HouseholdDashboardTotals {\n          viewerShareMinor\n          viewerPaidMinor\n          viewerNetMinor\n          openBalanceCount\n          activeSpaceCount\n          totalSharedExpenseMinor\n          totalSharedExpenseCount\n        }\n        ... on Problem {\n          code\n        }\n      }\n      spaces {\n        groupId\n        name\n        kind\n        isHousehold\n        currency\n        viewerNetMinor\n        sharedExpenseCount\n        viewerMembership {\n          id\n          role\n        }\n        balances @include(if: $balances) {\n          __typename\n          ... on GroupBalances {\n            settled\n            obligations {\n              from {\n                id\n                displayName\n              }\n              to {\n                id\n                displayName\n              }\n              amountMinor\n            }\n          }\n          ... on Problem {\n            code\n          }\n        }\n      }\n    }\n  }\n  householdExpenses(first: 5) @include(if: $recent) {\n    __typename\n    ... on Problem {\n      code\n    }\n    ... on ExpenseView {\n      edges {\n        node {\n          id\n          groupId\n          description\n          effectiveDate\n          totalMinor\n          category\n        }\n        source {\n          id\n          name\n          kind\n          isHousehold\n          currency\n        }\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "4b73bd55563079993764660c57a4f957";

export default node;
