/**
 * @generated SignedSource<<fabf545a4f05929295ac31daceebfbf9>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type Category = "ACCOMMODATION" | "ACTIVITIES" | "DINING" | "GROCERIES" | "HOME" | "OTHER" | "TRANSPORT" | "%future added value";
export type Currency = "USD" | "%future added value";
export type GroupKind = "ORDINARY" | "TRIP" | "%future added value";
export type MembershipRole = "MEMBER" | "OWNER" | "%future added value";
export type MembershipStatus = "ACTIVE" | "INACTIVE" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
export type journeyGroupQuery$variables = {
  after?: string | null | undefined;
  id: string;
};
export type journeyGroupQuery$data = {
  readonly group: {
    readonly __typename: "Group";
    readonly balances: {
      readonly __typename: "GroupBalances";
      readonly groupId: string;
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
      readonly revision: string;
      readonly settled: boolean;
      readonly totalExpenseMinor: string;
    } | {
      readonly __typename: "Problem";
      readonly code: ProblemCode;
      readonly message: string;
    } | {
      // This will never be '%other', but we need some
      // value in case none of the concrete values match.
      readonly __typename: "%other";
    };
    readonly currency: Currency;
    readonly expenses: {
      readonly edges: ReadonlyArray<{
        readonly cursor: string;
        readonly node: {
          readonly allocations: ReadonlyArray<{
            readonly amountMinor: string;
            readonly participant: {
              readonly displayName: string;
              readonly id: string;
            };
          }>;
          readonly category: Category;
          readonly description: string;
          readonly effectiveDate: string;
          readonly id: string;
          readonly note: string;
          readonly payer: {
            readonly displayName: string;
            readonly id: string;
          };
          readonly totalMinor: string;
        };
      }>;
      readonly pageInfo: {
        readonly endCursor: string | null | undefined;
        readonly hasNextPage: boolean;
        readonly hasPreviousPage: boolean;
        readonly startCursor: string | null | undefined;
      };
      readonly revision: string;
    } | null | undefined;
    readonly id: string;
    readonly isHousehold: boolean;
    readonly kind: GroupKind;
    readonly members: ReadonlyArray<{
      readonly canParticipate: boolean;
      readonly displayName: string;
      readonly id: string;
      readonly role: MembershipRole;
      readonly status: MembershipStatus;
    }>;
    readonly name: string;
    readonly repayments: {
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
  } | {
    readonly __typename: "Problem";
    readonly code: ProblemCode;
    readonly message: string;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
};
export type journeyGroupQuery = {
  response: journeyGroupQuery$data;
  variables: journeyGroupQuery$variables;
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
  "name": "id"
},
v2 = [
  {
    "kind": "Variable",
    "name": "id",
    "variableName": "id"
  }
],
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "__typename",
  "storageKey": null
},
v4 = {
  "kind": "InlineFragment",
  "selections": [
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "code",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "message",
      "storageKey": null
    }
  ],
  "type": "Problem",
  "abstractKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "role",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "displayName",
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "status",
  "storageKey": null
},
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "revision",
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "effectiveDate",
  "storageKey": null
},
v11 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "note",
  "storageKey": null
},
v12 = [
  (v5/*:: as any*/),
  (v7/*:: as any*/)
],
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
  "kind": "ScalarField",
  "name": "hasNextPage",
  "storageKey": null
},
v15 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "groupId",
  "storageKey": null
},
v16 = {
  "kind": "InlineFragment",
  "selections": [
    (v5/*:: as any*/),
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "name",
      "storageKey": null
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
      "kind": "ScalarField",
      "name": "kind",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "isHousehold",
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
        (v5/*:: as any*/),
        (v6/*:: as any*/)
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
        (v5/*:: as any*/),
        (v7/*:: as any*/),
        (v8/*:: as any*/),
        (v6/*:: as any*/),
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
      "alias": null,
      "args": [
        {
          "kind": "Variable",
          "name": "after",
          "variableName": "after"
        },
        {
          "kind": "Literal",
          "name": "first",
          "value": 20
        }
      ],
      "concreteType": "ExpenseConnection",
      "kind": "LinkedField",
      "name": "expenses",
      "plural": false,
      "selections": [
        (v9/*:: as any*/),
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
              "alias": null,
              "args": null,
              "concreteType": "Expense",
              "kind": "LinkedField",
              "name": "node",
              "plural": false,
              "selections": [
                (v5/*:: as any*/),
                {
                  "alias": null,
                  "args": null,
                  "kind": "ScalarField",
                  "name": "description",
                  "storageKey": null
                },
                (v10/*:: as any*/),
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
                (v11/*:: as any*/),
                {
                  "alias": null,
                  "args": null,
                  "concreteType": "Membership",
                  "kind": "LinkedField",
                  "name": "payer",
                  "plural": false,
                  "selections": (v12/*:: as any*/),
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
                      "selections": (v12/*:: as any*/),
                      "storageKey": null
                    },
                    (v13/*:: as any*/)
                  ],
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
            (v14/*:: as any*/),
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "hasPreviousPage",
              "storageKey": null
            },
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "startCursor",
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
        }
      ],
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "concreteType": null,
      "kind": "LinkedField",
      "name": "balances",
      "plural": false,
      "selections": [
        (v3/*:: as any*/),
        (v4/*:: as any*/),
        {
          "kind": "InlineFragment",
          "selections": [
            (v15/*:: as any*/),
            (v9/*:: as any*/),
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
                    (v5/*:: as any*/),
                    (v7/*:: as any*/),
                    (v8/*:: as any*/)
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
                  "selections": (v12/*:: as any*/),
                  "storageKey": null
                },
                {
                  "alias": null,
                  "args": null,
                  "concreteType": "Membership",
                  "kind": "LinkedField",
                  "name": "to",
                  "plural": false,
                  "selections": (v12/*:: as any*/),
                  "storageKey": null
                },
                (v13/*:: as any*/)
              ],
              "storageKey": null
            }
          ],
          "type": "GroupBalances",
          "abstractKey": null
        }
      ],
      "storageKey": null
    },
    {
      "kind": "ClientExtension",
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
                    (v5/*:: as any*/),
                    (v15/*:: as any*/),
                    (v13/*:: as any*/),
                    (v10/*:: as any*/),
                    (v11/*:: as any*/),
                    {
                      "alias": null,
                      "args": null,
                      "concreteType": "Membership",
                      "kind": "LinkedField",
                      "name": "sender",
                      "plural": false,
                      "selections": (v12/*:: as any*/),
                      "storageKey": null
                    },
                    {
                      "alias": null,
                      "args": null,
                      "concreteType": "Membership",
                      "kind": "LinkedField",
                      "name": "recipient",
                      "plural": false,
                      "selections": (v12/*:: as any*/),
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
                (v14/*:: as any*/)
              ],
              "storageKey": null
            }
          ],
          "storageKey": "repayments(first:5)"
        }
      ]
    }
  ],
  "type": "Group",
  "abstractKey": null
};
return {
  "fragment": {
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "journeyGroupQuery",
    "selections": [
      {
        "alias": null,
        "args": (v2/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "group",
        "plural": false,
        "selections": [
          (v3/*:: as any*/),
          (v4/*:: as any*/),
          (v16/*:: as any*/)
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
      (v1/*:: as any*/),
      (v0/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "journeyGroupQuery",
    "selections": [
      {
        "alias": null,
        "args": (v2/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "group",
        "plural": false,
        "selections": [
          (v3/*:: as any*/),
          (v4/*:: as any*/),
          (v16/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v5/*:: as any*/)
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
    "cacheID": "842e9cbc81a09ffba73559947bdd00a5",
    "id": null,
    "metadata": {},
    "name": "journeyGroupQuery",
    "operationKind": "query",
    "text": "query journeyGroupQuery(\n  $id: ID!\n  $after: String\n) {\n  group(id: $id) {\n    __typename\n    ... on Problem {\n      code\n      message\n    }\n    ... on Group {\n      id\n      name\n      currency\n      kind\n      isHousehold\n      trip {\n        destination\n        startDate\n        endDate\n      }\n      viewerMembership {\n        id\n        role\n      }\n      members {\n        id\n        displayName\n        status\n        role\n        canParticipate\n      }\n      expenses(first: 20, after: $after) {\n        revision\n        edges {\n          cursor\n          node {\n            id\n            description\n            effectiveDate\n            totalMinor\n            category\n            note\n            payer {\n              id\n              displayName\n            }\n            allocations {\n              participant {\n                id\n                displayName\n              }\n              amountMinor\n            }\n          }\n        }\n        pageInfo {\n          hasNextPage\n          hasPreviousPage\n          startCursor\n          endCursor\n        }\n      }\n      balances {\n        __typename\n        ... on Problem {\n          code\n          message\n        }\n        ... on GroupBalances {\n          groupId\n          revision\n          totalExpenseMinor\n          settled\n          positions {\n            member {\n              id\n              displayName\n              status\n            }\n            paidMinor\n            owedMinor\n            sentMinor\n            receivedMinor\n            netMinor\n          }\n          obligations {\n            from {\n              id\n              displayName\n            }\n            to {\n              id\n              displayName\n            }\n            amountMinor\n          }\n        }\n      }\n    }\n    ... on Node {\n      __isNode: __typename\n      id\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "430b031c41b185b18847bb8e7259caae";

export default node;
