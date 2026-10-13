/**
 * @generated SignedSource<<1f3bdee4d18a548e125fc1a38508cc20>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type Appearance = "DARK" | "LIGHT" | "SYSTEM" | "%future added value";
export type Category = "ACCOMMODATION" | "ACTIVITIES" | "DINING" | "GROCERIES" | "HOME" | "OTHER" | "TRANSPORT" | "%future added value";
export type ExpenseSort = "AMOUNT_ASC" | "AMOUNT_DESC" | "DATE_ASC" | "DATE_DESC" | "%future added value";
export type MembershipRole = "MEMBER" | "OWNER" | "%future added value";
export type MembershipStatus = "ACTIVE" | "INACTIVE" | "%future added value";
export type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "%future added value";
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
export type financialIdentityTestQuery$variables = {
  after?: string | null | undefined;
  expenseId: string;
  filter?: StructuredExpenseFilter | null | undefined;
  groupId: string;
};
export type financialIdentityTestQuery$data = {
  readonly currentProfile: {
    readonly __typename: "Profile";
    readonly appearance: Appearance;
    readonly displayName: string;
    readonly id: string;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
  readonly group: {
    readonly __typename: "Group";
    readonly expenses: {
      readonly edges: ReadonlyArray<{
        readonly cursor: string;
        readonly snapshot: {
          readonly allocations: ReadonlyArray<{
            readonly amountMinor: string;
            readonly participant: {
              readonly displayName: string;
              readonly id: string;
            };
            readonly percentageHundredths: number | null | undefined;
          }>;
          readonly category: Category;
          readonly description: string;
          readonly effectiveDate: string;
          readonly expenseId: string;
          readonly note: string;
          readonly payer: {
            readonly displayName: string;
            readonly id: string;
          };
          readonly split: SplitMode;
          readonly totalMinor: string;
          readonly version: string;
        };
      }>;
      readonly revision: string;
    } | null | undefined;
    readonly id: string;
    readonly members: ReadonlyArray<{
      readonly canParticipate: boolean;
      readonly displayName: string;
      readonly id: string;
      readonly role: MembershipRole;
      readonly status: MembershipStatus;
    }>;
    readonly name: string;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
  readonly groupActivity: {
    readonly __typename: "ActivityConnection";
    readonly edges: ReadonlyArray<{
      readonly node: {
        readonly id: string;
        readonly payer: {
          readonly displayName: string;
          readonly id: string;
        } | null | undefined;
      };
    }>;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
  readonly groupExpenses: {
    readonly " $fragmentSpreads": FragmentRefs<"expensesView">;
  };
  readonly node: {
    readonly __typename: "Expense";
    readonly allocations: ReadonlyArray<{
      readonly amountMinor: string;
      readonly participant: {
        readonly displayName: string;
        readonly id: string;
      };
      readonly percentageHundredths: number | null | undefined;
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
    readonly split: SplitMode;
    readonly totalMinor: string;
    readonly version: string;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  } | null | undefined;
  readonly viewer: {
    readonly __typename: "Viewer";
    readonly displayName: string;
    readonly id: string;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
};
export type financialIdentityTestQuery = {
  response: financialIdentityTestQuery$data;
  variables: financialIdentityTestQuery$variables;
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
  "name": "expenseId"
},
v2 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "filter"
},
v3 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "groupId"
},
v4 = [
  {
    "kind": "Variable",
    "name": "id",
    "variableName": "expenseId"
  }
],
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "__typename",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "version",
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
  "name": "totalMinor",
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
  "name": "category",
  "storageKey": null
},
v12 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "note",
  "storageKey": null
},
v13 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "split",
  "storageKey": null
},
v14 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "displayName",
  "storageKey": null
},
v15 = [
  (v6/*:: as any*/),
  (v14/*:: as any*/)
],
v16 = {
  "alias": null,
  "args": null,
  "concreteType": "Membership",
  "kind": "LinkedField",
  "name": "payer",
  "plural": false,
  "selections": (v15/*:: as any*/),
  "storageKey": null
},
v17 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "amountMinor",
  "storageKey": null
},
v18 = {
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
      "selections": (v15/*:: as any*/),
      "storageKey": null
    },
    (v17/*:: as any*/),
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "percentageHundredths",
      "storageKey": null
    }
  ],
  "storageKey": null
},
v19 = {
  "kind": "Variable",
  "name": "after",
  "variableName": "after"
},
v20 = {
  "kind": "Variable",
  "name": "groupId",
  "variableName": "groupId"
},
v21 = [
  (v19/*:: as any*/),
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
  (v20/*:: as any*/)
],
v22 = {
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
v23 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "contextVersion",
  "storageKey": null
},
v24 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "totalExpenseMinor",
  "storageKey": null
},
v25 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "viewerShareMinor",
  "storageKey": null
},
v26 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "viewerPaidMinor",
  "storageKey": null
},
v27 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "expenseCount",
  "storageKey": null
},
v28 = {
  "alias": null,
  "args": null,
  "concreteType": "ExpenseCategoryTotal",
  "kind": "LinkedField",
  "name": "categories",
  "plural": true,
  "selections": [
    (v11/*:: as any*/),
    (v24/*:: as any*/),
    (v25/*:: as any*/),
    (v27/*:: as any*/)
  ],
  "storageKey": null
},
v29 = {
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
    (v24/*:: as any*/),
    (v27/*:: as any*/)
  ],
  "storageKey": null
},
v30 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "cursor",
  "storageKey": null
},
v31 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "name",
  "storageKey": null
},
v32 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "currency",
  "storageKey": null
},
v33 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "expenseId",
  "storageKey": null
},
v34 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "groupId",
  "storageKey": null
},
v35 = [
  (v6/*:: as any*/)
],
v36 = {
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
      "selections": (v35/*:: as any*/),
      "storageKey": null
    },
    (v17/*:: as any*/)
  ],
  "storageKey": null
},
v37 = {
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
v38 = [
  {
    "kind": "Variable",
    "name": "id",
    "variableName": "groupId"
  }
],
v39 = {
  "alias": null,
  "args": null,
  "concreteType": "Membership",
  "kind": "LinkedField",
  "name": "members",
  "plural": true,
  "selections": [
    (v6/*:: as any*/),
    (v14/*:: as any*/),
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
},
v40 = {
  "kind": "Literal",
  "name": "first",
  "value": 20
},
v41 = [
  (v19/*:: as any*/),
  (v40/*:: as any*/)
],
v42 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "revision",
  "storageKey": null
},
v43 = {
  "alias": null,
  "args": [
    (v40/*:: as any*/),
    (v20/*:: as any*/)
  ],
  "concreteType": null,
  "kind": "LinkedField",
  "name": "groupActivity",
  "plural": false,
  "selections": [
    (v5/*:: as any*/),
    {
      "kind": "InlineFragment",
      "selections": [
        {
          "alias": null,
          "args": null,
          "concreteType": "ActivityEdge",
          "kind": "LinkedField",
          "name": "edges",
          "plural": true,
          "selections": [
            {
              "alias": null,
              "args": null,
              "concreteType": "ActivityEvent",
              "kind": "LinkedField",
              "name": "node",
              "plural": false,
              "selections": [
                (v6/*:: as any*/),
                {
                  "alias": null,
                  "args": null,
                  "concreteType": "ActivityIdentity",
                  "kind": "LinkedField",
                  "name": "payer",
                  "plural": false,
                  "selections": (v15/*:: as any*/),
                  "storageKey": null
                }
              ],
              "storageKey": null
            }
          ],
          "storageKey": null
        }
      ],
      "type": "ActivityConnection",
      "abstractKey": null
    }
  ],
  "storageKey": null
},
v44 = {
  "kind": "InlineFragment",
  "selections": (v15/*:: as any*/),
  "type": "Viewer",
  "abstractKey": null
},
v45 = {
  "alias": null,
  "args": null,
  "concreteType": null,
  "kind": "LinkedField",
  "name": "currentProfile",
  "plural": false,
  "selections": [
    (v5/*:: as any*/),
    {
      "kind": "InlineFragment",
      "selections": [
        (v6/*:: as any*/),
        (v14/*:: as any*/),
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "appearance",
          "storageKey": null
        }
      ],
      "type": "Profile",
      "abstractKey": null
    }
  ],
  "storageKey": null
},
v46 = {
  "kind": "InlineFragment",
  "selections": (v35/*:: as any*/),
  "type": "Node",
  "abstractKey": "__isNode"
};
return {
  "fragment": {
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/),
      (v2/*:: as any*/),
      (v3/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "financialIdentityTestQuery",
    "selections": [
      {
        "alias": null,
        "args": (v4/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "node",
        "plural": false,
        "selections": [
          (v5/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v6/*:: as any*/),
              (v7/*:: as any*/),
              (v8/*:: as any*/),
              (v9/*:: as any*/),
              (v10/*:: as any*/),
              (v11/*:: as any*/),
              (v12/*:: as any*/),
              (v13/*:: as any*/),
              (v16/*:: as any*/),
              (v18/*:: as any*/)
            ],
            "type": "Expense",
            "abstractKey": null
          }
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": (v21/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "groupExpenses",
        "plural": false,
        "selections": [
          {
            "kind": "InlineDataFragmentSpread",
            "name": "expensesView",
            "selections": [
              (v5/*:: as any*/),
              (v22/*:: as any*/),
              {
                "kind": "InlineFragment",
                "selections": [
                  (v23/*:: as any*/),
                  (v24/*:: as any*/),
                  (v25/*:: as any*/),
                  (v26/*:: as any*/),
                  (v28/*:: as any*/),
                  (v27/*:: as any*/),
                  (v29/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "ExpenseViewEdge",
                    "kind": "LinkedField",
                    "name": "edges",
                    "plural": true,
                    "selections": [
                      (v30/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "concreteType": "GroupSummary",
                        "kind": "LinkedField",
                        "name": "source",
                        "plural": false,
                        "selections": [
                          (v31/*:: as any*/),
                          (v32/*:: as any*/)
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
                          (v33/*:: as any*/),
                          (v7/*:: as any*/),
                          (v34/*:: as any*/),
                          (v8/*:: as any*/),
                          (v10/*:: as any*/),
                          (v11/*:: as any*/),
                          (v9/*:: as any*/),
                          (v16/*:: as any*/),
                          (v36/*:: as any*/)
                        ],
                        "storageKey": null
                      }
                    ],
                    "storageKey": null
                  },
                  (v37/*:: as any*/)
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
        "args": (v38/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "group",
        "plural": false,
        "selections": [
          (v5/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v6/*:: as any*/),
              (v31/*:: as any*/),
              (v39/*:: as any*/),
              {
                "alias": null,
                "args": (v41/*:: as any*/),
                "concreteType": "ExpenseConnection",
                "kind": "LinkedField",
                "name": "expenses",
                "plural": false,
                "selections": [
                  (v42/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "ExpenseEdge",
                    "kind": "LinkedField",
                    "name": "edges",
                    "plural": true,
                    "selections": [
                      (v30/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "concreteType": "ExpenseSnapshot",
                        "kind": "LinkedField",
                        "name": "snapshot",
                        "plural": false,
                        "selections": [
                          (v33/*:: as any*/),
                          (v7/*:: as any*/),
                          (v8/*:: as any*/),
                          (v9/*:: as any*/),
                          (v10/*:: as any*/),
                          (v11/*:: as any*/),
                          (v12/*:: as any*/),
                          (v13/*:: as any*/),
                          (v16/*:: as any*/),
                          (v18/*:: as any*/)
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
            "type": "Group",
            "abstractKey": null
          }
        ],
        "storageKey": null
      },
      (v43/*:: as any*/),
      {
        "alias": null,
        "args": null,
        "concreteType": null,
        "kind": "LinkedField",
        "name": "viewer",
        "plural": false,
        "selections": [
          (v5/*:: as any*/),
          (v44/*:: as any*/)
        ],
        "storageKey": null
      },
      (v45/*:: as any*/)
    ],
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [
      (v1/*:: as any*/),
      (v3/*:: as any*/),
      (v0/*:: as any*/),
      (v2/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "financialIdentityTestQuery",
    "selections": [
      {
        "alias": null,
        "args": (v4/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "node",
        "plural": false,
        "selections": [
          (v5/*:: as any*/),
          (v6/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v7/*:: as any*/),
              (v8/*:: as any*/),
              (v9/*:: as any*/),
              (v10/*:: as any*/),
              (v11/*:: as any*/),
              (v12/*:: as any*/),
              (v13/*:: as any*/),
              (v16/*:: as any*/),
              (v18/*:: as any*/)
            ],
            "type": "Expense",
            "abstractKey": null
          }
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": (v21/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "groupExpenses",
        "plural": false,
        "selections": [
          (v5/*:: as any*/),
          {
            "kind": "TypeDiscriminator",
            "abstractKey": "__isExpenseViewResult"
          },
          (v22/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v23/*:: as any*/),
              (v24/*:: as any*/),
              (v25/*:: as any*/),
              (v26/*:: as any*/),
              (v28/*:: as any*/),
              (v27/*:: as any*/),
              (v29/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "ExpenseViewEdge",
                "kind": "LinkedField",
                "name": "edges",
                "plural": true,
                "selections": [
                  (v30/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "GroupSummary",
                    "kind": "LinkedField",
                    "name": "source",
                    "plural": false,
                    "selections": [
                      (v31/*:: as any*/),
                      (v32/*:: as any*/),
                      (v6/*:: as any*/)
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
                      (v33/*:: as any*/),
                      (v7/*:: as any*/),
                      (v34/*:: as any*/),
                      (v8/*:: as any*/),
                      (v10/*:: as any*/),
                      (v11/*:: as any*/),
                      (v9/*:: as any*/),
                      (v16/*:: as any*/),
                      (v36/*:: as any*/),
                      (v6/*:: as any*/)
                    ],
                    "storageKey": null
                  }
                ],
                "storageKey": null
              },
              (v37/*:: as any*/),
              (v6/*:: as any*/)
            ],
            "type": "ExpenseView",
            "abstractKey": null
          }
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": (v38/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "group",
        "plural": false,
        "selections": [
          (v5/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v6/*:: as any*/),
              (v31/*:: as any*/),
              (v39/*:: as any*/),
              {
                "alias": null,
                "args": (v41/*:: as any*/),
                "concreteType": "ExpenseConnection",
                "kind": "LinkedField",
                "name": "expenses",
                "plural": false,
                "selections": [
                  (v42/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "ExpenseEdge",
                    "kind": "LinkedField",
                    "name": "edges",
                    "plural": true,
                    "selections": [
                      (v30/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "concreteType": "ExpenseSnapshot",
                        "kind": "LinkedField",
                        "name": "snapshot",
                        "plural": false,
                        "selections": [
                          (v33/*:: as any*/),
                          (v7/*:: as any*/),
                          (v8/*:: as any*/),
                          (v9/*:: as any*/),
                          (v10/*:: as any*/),
                          (v11/*:: as any*/),
                          (v12/*:: as any*/),
                          (v13/*:: as any*/),
                          (v16/*:: as any*/),
                          (v18/*:: as any*/),
                          (v6/*:: as any*/)
                        ],
                        "storageKey": null
                      }
                    ],
                    "storageKey": null
                  },
                  (v6/*:: as any*/)
                ],
                "storageKey": null
              }
            ],
            "type": "Group",
            "abstractKey": null
          },
          (v46/*:: as any*/)
        ],
        "storageKey": null
      },
      (v43/*:: as any*/),
      {
        "alias": null,
        "args": null,
        "concreteType": null,
        "kind": "LinkedField",
        "name": "viewer",
        "plural": false,
        "selections": [
          (v5/*:: as any*/),
          (v44/*:: as any*/),
          (v46/*:: as any*/)
        ],
        "storageKey": null
      },
      (v45/*:: as any*/)
    ]
  },
  "params": {
    "cacheID": "e03bb2145aecc1728c5e35930851017a",
    "id": null,
    "metadata": {},
    "name": "financialIdentityTestQuery",
    "operationKind": "query",
    "text": "query financialIdentityTestQuery(\n  $expenseId: ID!\n  $groupId: ID!\n  $after: String\n  $filter: StructuredExpenseFilter\n) {\n  node(id: $expenseId) {\n    __typename\n    ... on Expense {\n      id\n      version\n      description\n      totalMinor\n      effectiveDate\n      category\n      note\n      split\n      payer {\n        id\n        displayName\n      }\n      allocations {\n        participant {\n          id\n          displayName\n        }\n        amountMinor\n        percentageHundredths\n      }\n    }\n    id\n  }\n  groupExpenses(groupId: $groupId, first: 6, after: $after, filter: $filter) {\n    __typename\n    ...expensesView\n    ... on ExpenseView {\n      id\n    }\n  }\n  group(id: $groupId) {\n    __typename\n    ... on Group {\n      id\n      name\n      members {\n        id\n        displayName\n        status\n        role\n        canParticipate\n      }\n      expenses(first: 20, after: $after) {\n        revision\n        edges {\n          cursor\n          snapshot {\n            expenseId\n            version\n            description\n            totalMinor\n            effectiveDate\n            category\n            note\n            split\n            payer {\n              id\n              displayName\n            }\n            allocations {\n              participant {\n                id\n                displayName\n              }\n              amountMinor\n              percentageHundredths\n            }\n            id\n          }\n        }\n        id\n      }\n    }\n    ... on Node {\n      __isNode: __typename\n      id\n    }\n  }\n  groupActivity(groupId: $groupId, first: 20) {\n    __typename\n    ... on ActivityConnection {\n      edges {\n        node {\n          id\n          payer {\n            id\n            displayName\n          }\n        }\n      }\n    }\n  }\n  viewer {\n    __typename\n    ... on Viewer {\n      id\n      displayName\n    }\n    ... on Node {\n      __isNode: __typename\n      id\n    }\n  }\n  currentProfile {\n    __typename\n    ... on Profile {\n      id\n      displayName\n      appearance\n    }\n  }\n}\n\nfragment expensesView on ExpenseViewResult {\n  __isExpenseViewResult: __typename\n  __typename\n  ... on Problem {\n    code\n  }\n  ... on ExpenseView {\n    contextVersion\n    totalExpenseMinor\n    viewerShareMinor\n    viewerPaidMinor\n    categories {\n      category\n      totalExpenseMinor\n      viewerShareMinor\n      expenseCount\n    }\n    expenseCount\n    months {\n      month\n      totalExpenseMinor\n      expenseCount\n    }\n    edges {\n      cursor\n      source {\n        name\n        currency\n        id\n      }\n      node: snapshot {\n        expenseId\n        version\n        groupId\n        description\n        effectiveDate\n        category\n        totalMinor\n        payer {\n          id\n          displayName\n        }\n        allocations {\n          participant {\n            id\n          }\n          amountMinor\n        }\n        id\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "d316edef7e9a47584fe195f4a6046e9e";

export default node;
