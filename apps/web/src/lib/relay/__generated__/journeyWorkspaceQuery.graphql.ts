/**
 * @generated SignedSource<<dd9a4eac1f14c4cbc933a20219785e80>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type AccessState = "DISABLED" | "UNPROVISIONED" | "%future added value";
export type Category = "ACCOMMODATION" | "ACTIVITIES" | "DINING" | "GROCERIES" | "HOME" | "OTHER" | "TRANSPORT" | "%future added value";
export type ExpenseSort = "AMOUNT_ASC" | "AMOUNT_DESC" | "DATE_ASC" | "DATE_DESC" | "%future added value";
export type GroupKind = "ORDINARY" | "TRIP" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
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
export type journeyWorkspaceQuery$variables = {
  activity: boolean;
  balances: boolean;
  filter?: StructuredExpenseFilter | null | undefined;
  id: string;
  ledger: boolean;
  overview: boolean;
  summary: boolean;
};
export type journeyWorkspaceQuery$data = {
  readonly group: {
    readonly __typename: "Group";
    readonly id: string;
    readonly isHousehold: boolean;
    readonly kind: GroupKind;
    readonly name: string;
    readonly workspace: {
      readonly " $fragmentSpreads": FragmentRefs<"workspaceGroup">;
    } | null | undefined;
  } | {
    readonly __typename: "Problem";
    readonly code: ProblemCode;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
  readonly groupActivity?: {
    readonly " $fragmentSpreads": FragmentRefs<"activityFeed">;
  };
  readonly groupExpenses?: {
    readonly " $fragmentSpreads": FragmentRefs<"expensesView">;
  };
  readonly viewer: {
    readonly __typename: "Problem";
    readonly code: ProblemCode;
  } | {
    readonly __typename: "Viewer";
    readonly today: string;
  } | {
    readonly __typename: "ViewerAccess";
    readonly state: AccessState;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
};
export type journeyWorkspaceQuery = {
  response: journeyWorkspaceQuery$data;
  variables: journeyWorkspaceQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "activity"
},
v1 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "balances"
},
v2 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "filter"
},
v3 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "id"
},
v4 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "ledger"
},
v5 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "overview"
},
v6 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "summary"
},
v7 = {
  "kind": "Variable",
  "name": "groupId",
  "variableName": "id"
},
v8 = [
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
  (v7/*:: as any*/)
],
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "__typename",
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "code",
  "storageKey": null
},
v11 = {
  "kind": "InlineFragment",
  "selections": [
    (v10/*:: as any*/)
  ],
  "type": "Problem",
  "abstractKey": null
},
v12 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "contextVersion",
  "storageKey": null
},
v13 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "totalExpenseMinor",
  "storageKey": null
},
v14 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "viewerShareMinor",
  "storageKey": null
},
v15 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "viewerPaidMinor",
  "storageKey": null
},
v16 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "category",
  "storageKey": null
},
v17 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "expenseCount",
  "storageKey": null
},
v18 = {
  "alias": null,
  "args": null,
  "concreteType": "ExpenseCategoryTotal",
  "kind": "LinkedField",
  "name": "categories",
  "plural": true,
  "selections": [
    (v16/*:: as any*/),
    (v13/*:: as any*/),
    (v14/*:: as any*/),
    (v17/*:: as any*/)
  ],
  "storageKey": null
},
v19 = {
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
    (v13/*:: as any*/),
    (v17/*:: as any*/)
  ],
  "storageKey": null
},
v20 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "cursor",
  "storageKey": null
},
v21 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "name",
  "storageKey": null
},
v22 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "currency",
  "storageKey": null
},
v23 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "expenseId",
  "storageKey": null
},
v24 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "groupId",
  "storageKey": null
},
v25 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "description",
  "storageKey": null
},
v26 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "effectiveDate",
  "storageKey": null
},
v27 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "totalMinor",
  "storageKey": null
},
v28 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v29 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "displayName",
  "storageKey": null
},
v30 = [
  (v28/*:: as any*/),
  (v29/*:: as any*/)
],
v31 = {
  "alias": null,
  "args": null,
  "concreteType": "Membership",
  "kind": "LinkedField",
  "name": "payer",
  "plural": false,
  "selections": (v30/*:: as any*/),
  "storageKey": null
},
v32 = [
  (v28/*:: as any*/)
],
v33 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "amountMinor",
  "storageKey": null
},
v34 = {
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
      "selections": (v32/*:: as any*/),
      "storageKey": null
    },
    (v33/*:: as any*/)
  ],
  "storageKey": null
},
v35 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "hasNextPage",
  "storageKey": null
},
v36 = {
  "alias": null,
  "args": null,
  "concreteType": "PageInfo",
  "kind": "LinkedField",
  "name": "pageInfo",
  "plural": false,
  "selections": [
    (v35/*:: as any*/),
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
v37 = [
  {
    "kind": "Literal",
    "name": "first",
    "value": 20
  },
  (v7/*:: as any*/)
],
v38 = {
  "kind": "InlineFragment",
  "selections": [
    (v10/*:: as any*/),
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
v39 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "note",
  "storageKey": null
},
v40 = {
  "alias": null,
  "args": null,
  "concreteType": "ActivityIdentity",
  "kind": "LinkedField",
  "name": "payer",
  "plural": false,
  "selections": (v30/*:: as any*/),
  "storageKey": null
},
v41 = [
  (v25/*:: as any*/),
  (v27/*:: as any*/),
  (v26/*:: as any*/),
  (v16/*:: as any*/),
  (v39/*:: as any*/),
  (v40/*:: as any*/),
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "split",
    "storageKey": null
  },
  {
    "alias": null,
    "args": null,
    "concreteType": "ActivityAllocation",
    "kind": "LinkedField",
    "name": "allocations",
    "plural": true,
    "selections": [
      {
        "alias": null,
        "args": null,
        "concreteType": "ActivityIdentity",
        "kind": "LinkedField",
        "name": "participant",
        "plural": false,
        "selections": (v30/*:: as any*/),
        "storageKey": null
      },
      (v33/*:: as any*/),
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "percentageHundredths",
        "storageKey": null
      }
    ],
    "storageKey": null
  }
],
v42 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "kind",
  "storageKey": null
},
v43 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "isHousehold",
  "storageKey": null
},
v44 = {
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
        (v20/*:: as any*/),
        {
          "alias": null,
          "args": null,
          "concreteType": "ActivityEvent",
          "kind": "LinkedField",
          "name": "node",
          "plural": false,
          "selections": [
            (v28/*:: as any*/),
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "recordId",
              "storageKey": null
            },
            (v25/*:: as any*/),
            (v39/*:: as any*/),
            {
              "alias": null,
              "args": null,
              "concreteType": "ActivityExpenseSnapshot",
              "kind": "LinkedField",
              "name": "before",
              "plural": false,
              "selections": (v41/*:: as any*/),
              "storageKey": null
            },
            {
              "alias": null,
              "args": null,
              "concreteType": "ActivityExpenseSnapshot",
              "kind": "LinkedField",
              "name": "after",
              "plural": false,
              "selections": (v41/*:: as any*/),
              "storageKey": null
            },
            (v42/*:: as any*/),
            (v24/*:: as any*/),
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "groupName",
              "storageKey": null
            },
            (v43/*:: as any*/),
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "groupKind",
              "storageKey": null
            },
            (v33/*:: as any*/),
            (v22/*:: as any*/),
            (v26/*:: as any*/),
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "timestamp",
              "storageKey": null
            },
            {
              "alias": null,
              "args": null,
              "concreteType": "ActivityIdentity",
              "kind": "LinkedField",
              "name": "creator",
              "plural": false,
              "selections": (v30/*:: as any*/),
              "storageKey": null
            },
            (v40/*:: as any*/),
            {
              "alias": null,
              "args": null,
              "concreteType": "ActivityIdentity",
              "kind": "LinkedField",
              "name": "sender",
              "plural": false,
              "selections": (v30/*:: as any*/),
              "storageKey": null
            },
            {
              "alias": null,
              "args": null,
              "concreteType": "ActivityIdentity",
              "kind": "LinkedField",
              "name": "recipient",
              "plural": false,
              "selections": (v30/*:: as any*/),
              "storageKey": null
            }
          ],
          "storageKey": null
        }
      ],
      "storageKey": null
    },
    (v36/*:: as any*/)
  ],
  "type": "ActivityConnection",
  "abstractKey": null
},
v45 = {
  "kind": "InlineFragment",
  "selections": [
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "state",
      "storageKey": null
    }
  ],
  "type": "ViewerAccess",
  "abstractKey": null
},
v46 = {
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
v47 = [
  {
    "kind": "Variable",
    "name": "id",
    "variableName": "id"
  }
],
v48 = {
  "kind": "InlineFragment",
  "selections": (v32/*:: as any*/),
  "type": "Node",
  "abstractKey": "__isNode"
},
v49 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "role",
  "storageKey": null
},
v50 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "status",
  "storageKey": null
};
return {
  "fragment": {
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/),
      (v2/*:: as any*/),
      (v3/*:: as any*/),
      (v4/*:: as any*/),
      (v5/*:: as any*/),
      (v6/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "journeyWorkspaceQuery",
    "selections": [
      {
        "condition": "ledger",
        "kind": "Condition",
        "passingValue": true,
        "selections": [
          {
            "alias": null,
            "args": (v8/*:: as any*/),
            "concreteType": null,
            "kind": "LinkedField",
            "name": "groupExpenses",
            "plural": false,
            "selections": [
              {
                "kind": "InlineDataFragmentSpread",
                "name": "expensesView",
                "selections": [
                  (v9/*:: as any*/),
                  (v11/*:: as any*/),
                  {
                    "kind": "InlineFragment",
                    "selections": [
                      (v12/*:: as any*/),
                      (v13/*:: as any*/),
                      (v14/*:: as any*/),
                      (v15/*:: as any*/),
                      (v18/*:: as any*/),
                      (v17/*:: as any*/),
                      (v19/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "concreteType": "ExpenseViewEdge",
                        "kind": "LinkedField",
                        "name": "edges",
                        "plural": true,
                        "selections": [
                          (v20/*:: as any*/),
                          {
                            "alias": null,
                            "args": null,
                            "concreteType": "GroupSummary",
                            "kind": "LinkedField",
                            "name": "source",
                            "plural": false,
                            "selections": [
                              (v21/*:: as any*/),
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
                              (v23/*:: as any*/),
                              (v24/*:: as any*/),
                              (v25/*:: as any*/),
                              (v26/*:: as any*/),
                              (v16/*:: as any*/),
                              (v27/*:: as any*/),
                              (v31/*:: as any*/),
                              (v34/*:: as any*/)
                            ],
                            "storageKey": null
                          }
                        ],
                        "storageKey": null
                      },
                      (v36/*:: as any*/)
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
        ]
      },
      {
        "condition": "activity",
        "kind": "Condition",
        "passingValue": true,
        "selections": [
          {
            "alias": null,
            "args": (v37/*:: as any*/),
            "concreteType": null,
            "kind": "LinkedField",
            "name": "groupActivity",
            "plural": false,
            "selections": [
              {
                "kind": "InlineDataFragmentSpread",
                "name": "activityFeed",
                "selections": [
                  (v9/*:: as any*/),
                  (v38/*:: as any*/),
                  (v44/*:: as any*/)
                ],
                "args": null,
                "argumentDefinitions": []
              }
            ],
            "storageKey": null
          }
        ]
      },
      {
        "alias": null,
        "args": null,
        "concreteType": null,
        "kind": "LinkedField",
        "name": "viewer",
        "plural": false,
        "selections": [
          (v9/*:: as any*/),
          (v11/*:: as any*/),
          (v45/*:: as any*/),
          (v46/*:: as any*/)
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": (v47/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "group",
        "plural": false,
        "selections": [
          (v9/*:: as any*/),
          (v11/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v28/*:: as any*/),
              (v21/*:: as any*/),
              (v42/*:: as any*/),
              (v43/*:: as any*/),
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
                        },
                        {
                          "kind": "Variable",
                          "name": "overview",
                          "variableName": "overview"
                        },
                        {
                          "kind": "Variable",
                          "name": "summary",
                          "variableName": "summary"
                        }
                      ],
                      "kind": "FragmentSpread",
                      "name": "workspaceGroup"
                    }
                  ],
                  "type": "Group",
                  "abstractKey": null
                },
                "kind": "AliasedInlineFragmentSpread",
                "name": "workspace"
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
    "argumentDefinitions": [
      (v3/*:: as any*/),
      (v5/*:: as any*/),
      (v1/*:: as any*/),
      (v6/*:: as any*/),
      (v4/*:: as any*/),
      (v0/*:: as any*/),
      (v2/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "journeyWorkspaceQuery",
    "selections": [
      {
        "condition": "ledger",
        "kind": "Condition",
        "passingValue": true,
        "selections": [
          {
            "alias": null,
            "args": (v8/*:: as any*/),
            "concreteType": null,
            "kind": "LinkedField",
            "name": "groupExpenses",
            "plural": false,
            "selections": [
              (v9/*:: as any*/),
              {
                "kind": "TypeDiscriminator",
                "abstractKey": "__isExpenseViewResult"
              },
              (v11/*:: as any*/),
              {
                "kind": "InlineFragment",
                "selections": [
                  (v12/*:: as any*/),
                  (v13/*:: as any*/),
                  (v14/*:: as any*/),
                  (v15/*:: as any*/),
                  (v18/*:: as any*/),
                  (v17/*:: as any*/),
                  (v19/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "ExpenseViewEdge",
                    "kind": "LinkedField",
                    "name": "edges",
                    "plural": true,
                    "selections": [
                      (v20/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "concreteType": "GroupSummary",
                        "kind": "LinkedField",
                        "name": "source",
                        "plural": false,
                        "selections": [
                          (v21/*:: as any*/),
                          (v22/*:: as any*/),
                          (v28/*:: as any*/)
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
                          (v23/*:: as any*/),
                          (v24/*:: as any*/),
                          (v25/*:: as any*/),
                          (v26/*:: as any*/),
                          (v16/*:: as any*/),
                          (v27/*:: as any*/),
                          (v31/*:: as any*/),
                          (v34/*:: as any*/),
                          (v28/*:: as any*/)
                        ],
                        "storageKey": null
                      }
                    ],
                    "storageKey": null
                  },
                  (v36/*:: as any*/),
                  (v28/*:: as any*/)
                ],
                "type": "ExpenseView",
                "abstractKey": null
              }
            ],
            "storageKey": null
          }
        ]
      },
      {
        "condition": "activity",
        "kind": "Condition",
        "passingValue": true,
        "selections": [
          {
            "alias": null,
            "args": (v37/*:: as any*/),
            "concreteType": null,
            "kind": "LinkedField",
            "name": "groupActivity",
            "plural": false,
            "selections": [
              (v9/*:: as any*/),
              {
                "kind": "TypeDiscriminator",
                "abstractKey": "__isActivityResult"
              },
              (v38/*:: as any*/),
              (v44/*:: as any*/)
            ],
            "storageKey": null
          }
        ]
      },
      {
        "alias": null,
        "args": null,
        "concreteType": null,
        "kind": "LinkedField",
        "name": "viewer",
        "plural": false,
        "selections": [
          (v9/*:: as any*/),
          (v11/*:: as any*/),
          (v45/*:: as any*/),
          (v46/*:: as any*/),
          (v48/*:: as any*/)
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": (v47/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "group",
        "plural": false,
        "selections": [
          (v9/*:: as any*/),
          (v11/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v28/*:: as any*/),
              (v21/*:: as any*/),
              (v42/*:: as any*/),
              (v43/*:: as any*/),
              (v22/*:: as any*/),
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
                  (v28/*:: as any*/),
                  (v49/*:: as any*/)
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
                  (v28/*:: as any*/),
                  (v29/*:: as any*/),
                  (v50/*:: as any*/),
                  (v49/*:: as any*/),
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
                "condition": "overview",
                "kind": "Condition",
                "passingValue": true,
                "selections": [
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
                          (v20/*:: as any*/),
                          {
                            "alias": "node",
                            "args": null,
                            "concreteType": "ExpenseSnapshot",
                            "kind": "LinkedField",
                            "name": "snapshot",
                            "plural": false,
                            "selections": [
                              (v23/*:: as any*/),
                              (v25/*:: as any*/),
                              (v26/*:: as any*/),
                              (v27/*:: as any*/),
                              (v16/*:: as any*/),
                              {
                                "alias": null,
                                "args": null,
                                "concreteType": "Membership",
                                "kind": "LinkedField",
                                "name": "payer",
                                "plural": false,
                                "selections": [
                                  (v29/*:: as any*/),
                                  (v28/*:: as any*/)
                                ],
                                "storageKey": null
                              },
                              (v34/*:: as any*/),
                              (v28/*:: as any*/)
                            ],
                            "storageKey": null
                          }
                        ],
                        "storageKey": null
                      },
                      (v28/*:: as any*/)
                    ],
                    "storageKey": "expenses(first:4)"
                  }
                ]
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
                              (v28/*:: as any*/),
                              (v24/*:: as any*/),
                              (v33/*:: as any*/),
                              (v26/*:: as any*/),
                              (v39/*:: as any*/),
                              {
                                "alias": null,
                                "args": null,
                                "concreteType": "Membership",
                                "kind": "LinkedField",
                                "name": "sender",
                                "plural": false,
                                "selections": (v30/*:: as any*/),
                                "storageKey": null
                              },
                              {
                                "alias": null,
                                "args": null,
                                "concreteType": "Membership",
                                "kind": "LinkedField",
                                "name": "recipient",
                                "plural": false,
                                "selections": (v30/*:: as any*/),
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
                          (v35/*:: as any*/)
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
                      (v9/*:: as any*/),
                      {
                        "kind": "InlineFragment",
                        "selections": [
                          (v24/*:: as any*/),
                          (v13/*:: as any*/),
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
                                  (v28/*:: as any*/),
                                  (v29/*:: as any*/),
                                  (v50/*:: as any*/)
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
                                    "selections": (v30/*:: as any*/),
                                    "storageKey": null
                                  },
                                  {
                                    "alias": null,
                                    "args": null,
                                    "concreteType": "Membership",
                                    "kind": "LinkedField",
                                    "name": "to",
                                    "plural": false,
                                    "selections": (v30/*:: as any*/),
                                    "storageKey": null
                                  },
                                  (v33/*:: as any*/)
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
          },
          (v48/*:: as any*/)
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "eef6211816eef98d4c1b58ef08cc3163",
    "id": null,
    "metadata": {},
    "name": "journeyWorkspaceQuery",
    "operationKind": "query",
    "text": "query journeyWorkspaceQuery(\n  $id: ID!\n  $overview: Boolean!\n  $balances: Boolean!\n  $summary: Boolean!\n  $ledger: Boolean!\n  $activity: Boolean!\n  $filter: StructuredExpenseFilter\n) {\n  groupExpenses(groupId: $id, first: 6, filter: $filter) @include(if: $ledger) {\n    __typename\n    ...expensesView\n    ... on ExpenseView {\n      id\n    }\n  }\n  groupActivity(groupId: $id, first: 20) @include(if: $activity) {\n    __typename\n    ...activityFeed\n  }\n  viewer {\n    __typename\n    ... on Problem {\n      code\n    }\n    ... on ViewerAccess {\n      state\n    }\n    ... on Viewer {\n      today\n    }\n    ... on Node {\n      __isNode: __typename\n      id\n    }\n  }\n  group(id: $id) {\n    __typename\n    ... on Problem {\n      code\n    }\n    ... on Group {\n      id\n      name\n      kind\n      isHousehold\n      ...workspaceGroup_3dd8Y9\n    }\n    ... on Node {\n      __isNode: __typename\n      id\n    }\n  }\n}\n\nfragment activityFeed on ActivityResult {\n  __isActivityResult: __typename\n  __typename\n  ... on Problem {\n    code\n    message\n  }\n  ... on ActivityConnection {\n    edges {\n      cursor\n      node {\n        id\n        recordId\n        description\n        note\n        before {\n          description\n          totalMinor\n          effectiveDate\n          category\n          note\n          payer {\n            id\n            displayName\n          }\n          split\n          allocations {\n            participant {\n              id\n              displayName\n            }\n            amountMinor\n            percentageHundredths\n          }\n        }\n        after {\n          description\n          totalMinor\n          effectiveDate\n          category\n          note\n          payer {\n            id\n            displayName\n          }\n          split\n          allocations {\n            participant {\n              id\n              displayName\n            }\n            amountMinor\n            percentageHundredths\n          }\n        }\n        kind\n        groupId\n        groupName\n        isHousehold\n        groupKind\n        amountMinor\n        currency\n        effectiveDate\n        timestamp\n        creator {\n          id\n          displayName\n        }\n        payer {\n          id\n          displayName\n        }\n        sender {\n          id\n          displayName\n        }\n        recipient {\n          id\n          displayName\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}\n\nfragment expensesView on ExpenseViewResult {\n  __isExpenseViewResult: __typename\n  __typename\n  ... on Problem {\n    code\n  }\n  ... on ExpenseView {\n    contextVersion\n    totalExpenseMinor\n    viewerShareMinor\n    viewerPaidMinor\n    categories {\n      category\n      totalExpenseMinor\n      viewerShareMinor\n      expenseCount\n    }\n    expenseCount\n    months {\n      month\n      totalExpenseMinor\n      expenseCount\n    }\n    edges {\n      cursor\n      source {\n        name\n        currency\n        id\n      }\n      node: snapshot {\n        expenseId\n        groupId\n        description\n        effectiveDate\n        category\n        totalMinor\n        payer {\n          id\n          displayName\n        }\n        allocations {\n          participant {\n            id\n          }\n          amountMinor\n        }\n        id\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}\n\nfragment workspaceGroup_3dd8Y9 on Group {\n  currency\n  trip {\n    destination\n    startDate\n    endDate\n  }\n  viewerMembership {\n    id\n    role\n  }\n  members {\n    id\n    displayName\n    status\n    role\n    canParticipate\n  }\n  expenses(first: 4) @include(if: $overview) {\n    edges {\n      cursor\n      node: snapshot {\n        expenseId\n        description\n        effectiveDate\n        totalMinor\n        category\n        payer {\n          displayName\n          id\n        }\n        allocations {\n          participant {\n            id\n          }\n          amountMinor\n        }\n        id\n      }\n    }\n    id\n  }\n  repayments(first: 5) @include(if: $balances) {\n    edges {\n      node {\n        id\n        groupId\n        amountMinor\n        effectiveDate\n        note\n        sender {\n          id\n          displayName\n        }\n        recipient {\n          id\n          displayName\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n    }\n  }\n  balances @include(if: $summary) {\n    __typename\n    ... on GroupBalances {\n      groupId\n      totalExpenseMinor\n      settled\n      positions {\n        member {\n          id\n          displayName\n          status\n        }\n        paidMinor\n        owedMinor\n        sentMinor\n        receivedMinor\n        netMinor\n      }\n      obligations @include(if: $balances) {\n        from {\n          id\n          displayName\n        }\n        to {\n          id\n          displayName\n        }\n        amountMinor\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "0363ec30b23394b5c0c1c12efbf2a6f4";

export default node;
