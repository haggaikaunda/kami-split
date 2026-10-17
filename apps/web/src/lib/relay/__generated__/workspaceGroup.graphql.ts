/**
 * @generated SignedSource<<96c8773c30529ccf984913a7f1922249>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderFragment } from 'relay-runtime';
export type Category = "ACCOMMODATION" | "ACTIVITIES" | "DINING" | "GROCERIES" | "HOME" | "OTHER" | "TRANSPORT" | "%future added value";
export type Currency = "USD" | "%future added value";
export type MembershipRole = "MEMBER" | "OWNER" | "%future added value";
export type MembershipStatus = "ACTIVE" | "INACTIVE" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
import { FragmentRefs } from "relay-runtime";
export type workspaceGroup$data = {
  readonly balances?: {
    readonly __typename: "GroupBalances";
    readonly groupId: string;
    readonly obligations?: ReadonlyArray<{
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
    readonly positions: ReadonlyArray<{
      readonly member: {
        readonly displayName: string;
        readonly id: string;
        readonly status: MembershipStatus;
      };
      readonly netMinor: string;
      readonly owedMinor: string;
      readonly paidMinor: string;
      readonly receivedMinor: string;
      readonly sentMinor: string;
    }>;
    readonly settled: boolean;
    readonly totalExpenseMinor: string;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
  readonly currency: Currency;
  readonly expenses?: {
    readonly edges: ReadonlyArray<{
      readonly cursor: string;
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
        readonly payer: {
          readonly displayName: string;
        };
        readonly totalMinor: string;
      };
    }>;
  } | null | undefined;
  readonly financialSummary?: {
    readonly __typename: "GroupFinancialSummary";
    readonly totalSpendMinor: string;
    readonly viewerNetMinor: string;
  } | {
    readonly __typename: "Problem";
    readonly code: ProblemCode;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
  readonly members: ReadonlyArray<{
    readonly canParticipate: boolean;
    readonly displayName: string;
    readonly id: string;
    readonly role: MembershipRole;
    readonly status: MembershipStatus;
  }>;
  readonly repayments?: {
    readonly edges: ReadonlyArray<{
      readonly node: {
        readonly amountMinor: string;
        readonly effectiveDate: string;
        readonly groupId: string;
        readonly id: string;
        readonly note: string;
        readonly recipient: {
          readonly displayName: string;
          readonly id: string;
        };
        readonly sender: {
          readonly displayName: string;
          readonly id: string;
        };
      };
    }>;
    readonly pageInfo: {
      readonly hasNextPage: boolean;
    };
  } | null | undefined;
  readonly trip: {
    readonly destination: string;
    readonly endDate: string;
    readonly startDate: string;
  } | null | undefined;
  readonly viewerMembership: {
    readonly id: string;
    readonly role: MembershipRole;
  };
  readonly " $fragmentType": "workspaceGroup";
};
export type workspaceGroup$key = {
  readonly " $data"?: workspaceGroup$data;
  readonly " $fragmentSpreads": FragmentRefs<"workspaceGroup">;
};

const node: ReaderFragment = (function(){
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
  "name": "effectiveDate",
  "storageKey": null
},
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "displayName",
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
  "name": "amountMinor",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "role",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "status",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "groupId",
  "storageKey": null
},
v8 = [
  (v3/*:: as any*/),
  (v2/*:: as any*/)
];
return {
  "argumentDefinitions": [
    {
      "defaultValue": null,
      "kind": "LocalArgument",
      "name": "balances"
    },
    {
      "defaultValue": null,
      "kind": "LocalArgument",
      "name": "overview"
    },
    {
      "defaultValue": null,
      "kind": "LocalArgument",
      "name": "summary"
    }
  ],
  "kind": "Fragment",
  "metadata": null,
  "name": "workspaceGroup",
  "selections": [
    {
      "condition": "overview",
      "kind": "Condition",
      "passingValue": true,
      "selections": [
        {
          "alias": null,
          "args": null,
          "concreteType": null,
          "kind": "LinkedField",
          "name": "financialSummary",
          "plural": false,
          "selections": [
            (v0/*:: as any*/),
            {
              "kind": "InlineFragment",
              "selections": [
                {
                  "alias": null,
                  "args": null,
                  "kind": "ScalarField",
                  "name": "totalSpendMinor",
                  "storageKey": null
                },
                {
                  "alias": null,
                  "args": null,
                  "kind": "ScalarField",
                  "name": "viewerNetMinor",
                  "storageKey": null
                }
              ],
              "type": "GroupFinancialSummary",
              "abstractKey": null
            },
            {
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
            }
          ],
          "storageKey": null
        },
        {
          "alias": null,
          "args": [
            {
              "kind": "Literal",
              "name": "first",
              "value": 4
            }
          ],
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
                  "kind": "ScalarField",
                  "name": "cursor",
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
                    {
                      "alias": null,
                      "args": null,
                      "kind": "ScalarField",
                      "name": "expenseId",
                      "storageKey": null
                    },
                    {
                      "alias": null,
                      "args": null,
                      "kind": "ScalarField",
                      "name": "description",
                      "storageKey": null
                    },
                    (v1/*:: as any*/),
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
                    },
                    {
                      "alias": null,
                      "args": null,
                      "concreteType": "Membership",
                      "kind": "LinkedField",
                      "name": "payer",
                      "plural": false,
                      "selections": [
                        (v2/*:: as any*/)
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
                            (v3/*:: as any*/)
                          ],
                          "storageKey": null
                        },
                        (v4/*:: as any*/)
                      ],
                      "storageKey": null
                    }
                  ],
                  "storageKey": null
                }
              ],
              "storageKey": null
            }
          ],
          "storageKey": "expenses(first:4)"
        }
      ]
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "currency",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "concreteType": "GroupTrip",
      "kind": "LinkedField",
      "name": "trip",
      "plural": false,
      "selections": [
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "destination",
          "storageKey": null
        },
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "startDate",
          "storageKey": null
        },
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "endDate",
          "storageKey": null
        }
      ],
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
        (v3/*:: as any*/),
        (v5/*:: as any*/)
      ],
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
        (v3/*:: as any*/),
        (v2/*:: as any*/),
        (v6/*:: as any*/),
        (v5/*:: as any*/),
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "canParticipate",
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
          "args": [
            {
              "kind": "Literal",
              "name": "first",
              "value": 5
            }
          ],
          "concreteType": "RepaymentConnection",
          "kind": "LinkedField",
          "name": "repayments",
          "plural": false,
          "selections": [
            {
              "alias": null,
              "args": null,
              "concreteType": "RepaymentEdge",
              "kind": "LinkedField",
              "name": "edges",
              "plural": true,
              "selections": [
                {
                  "alias": null,
                  "args": null,
                  "concreteType": "Repayment",
                  "kind": "LinkedField",
                  "name": "node",
                  "plural": false,
                  "selections": [
                    (v3/*:: as any*/),
                    (v7/*:: as any*/),
                    (v4/*:: as any*/),
                    (v1/*:: as any*/),
                    {
                      "alias": null,
                      "args": null,
                      "kind": "ScalarField",
                      "name": "note",
                      "storageKey": null
                    },
                    {
                      "alias": null,
                      "args": null,
                      "concreteType": "Membership",
                      "kind": "LinkedField",
                      "name": "sender",
                      "plural": false,
                      "selections": (v8/*:: as any*/),
                      "storageKey": null
                    },
                    {
                      "alias": null,
                      "args": null,
                      "concreteType": "Membership",
                      "kind": "LinkedField",
                      "name": "recipient",
                      "plural": false,
                      "selections": (v8/*:: as any*/),
                      "storageKey": null
                    }
                  ],
                  "storageKey": null
                }
              ],
              "storageKey": null
            },
            {
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
                }
              ],
              "storageKey": null
            }
          ],
          "storageKey": "repayments(first:5)"
        }
      ]
    },
    {
      "condition": "summary",
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
            (v0/*:: as any*/),
            {
              "kind": "InlineFragment",
              "selections": [
                (v7/*:: as any*/),
                {
                  "alias": null,
                  "args": null,
                  "kind": "ScalarField",
                  "name": "totalExpenseMinor",
                  "storageKey": null
                },
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
                  "concreteType": "MemberPosition",
                  "kind": "LinkedField",
                  "name": "positions",
                  "plural": true,
                  "selections": [
                    {
                      "alias": null,
                      "args": null,
                      "concreteType": "Membership",
                      "kind": "LinkedField",
                      "name": "member",
                      "plural": false,
                      "selections": [
                        (v3/*:: as any*/),
                        (v2/*:: as any*/),
                        (v6/*:: as any*/)
                      ],
                      "storageKey": null
                    },
                    {
                      "alias": null,
                      "args": null,
                      "kind": "ScalarField",
                      "name": "paidMinor",
                      "storageKey": null
                    },
                    {
                      "alias": null,
                      "args": null,
                      "kind": "ScalarField",
                      "name": "owedMinor",
                      "storageKey": null
                    },
                    {
                      "alias": null,
                      "args": null,
                      "kind": "ScalarField",
                      "name": "sentMinor",
                      "storageKey": null
                    },
                    {
                      "alias": null,
                      "args": null,
                      "kind": "ScalarField",
                      "name": "receivedMinor",
                      "storageKey": null
                    },
                    {
                      "alias": null,
                      "args": null,
                      "kind": "ScalarField",
                      "name": "netMinor",
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
                          "selections": (v8/*:: as any*/),
                          "storageKey": null
                        },
                        {
                          "alias": null,
                          "args": null,
                          "concreteType": "Membership",
                          "kind": "LinkedField",
                          "name": "to",
                          "plural": false,
                          "selections": (v8/*:: as any*/),
                          "storageKey": null
                        },
                        (v4/*:: as any*/)
                      ],
                      "storageKey": null
                    }
                  ]
                }
              ],
              "type": "GroupBalances",
              "abstractKey": null
            }
          ],
          "storageKey": null
        }
      ]
    }
  ],
  "type": "Group",
  "abstractKey": null
};
})();

(node as any).hash = "e782cbd0737e3e25eee233a1abe2100e";

export default node;
