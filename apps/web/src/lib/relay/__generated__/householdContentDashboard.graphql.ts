/**
 * @generated SignedSource<<321f4c7f8a4ab641b5c24e55a1204637>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderFragment } from 'relay-runtime';
export type Currency = "USD" | "%future added value";
export type GroupKind = "ORDINARY" | "TRIP" | "%future added value";
export type HouseholdDashboardState = "COMPLETE" | "INCOMPLETE" | "UNAVAILABLE" | "%future added value";
export type MembershipRole = "MEMBER" | "OWNER" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
import { FragmentRefs } from "relay-runtime";
export type householdContentDashboard$data = {
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
  readonly " $fragmentType": "householdContentDashboard";
};
export type householdContentDashboard$key = {
  readonly " $data"?: householdContentDashboard$data;
  readonly " $fragmentSpreads": FragmentRefs<"householdContentDashboard">;
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
  "name": "viewerNetMinor",
  "storageKey": null
},
v2 = {
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
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v4 = [
  (v3/*:: as any*/),
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "displayName",
    "storageKey": null
  }
];
return {
  "argumentDefinitions": [
    {
      "defaultValue": null,
      "kind": "LocalArgument",
      "name": "balances"
    }
  ],
  "kind": "Fragment",
  "metadata": null,
  "name": "householdContentDashboard",
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
        (v0/*:: as any*/),
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
            (v1/*:: as any*/),
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
        (v2/*:: as any*/)
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
          "name": "name",
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
          "kind": "ScalarField",
          "name": "currency",
          "storageKey": null
        },
        (v1/*:: as any*/),
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
            (v3/*:: as any*/),
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
                (v0/*:: as any*/),
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
                          "selections": (v4/*:: as any*/),
                          "storageKey": null
                        },
                        {
                          "alias": null,
                          "args": null,
                          "concreteType": "Membership",
                          "kind": "LinkedField",
                          "name": "to",
                          "plural": false,
                          "selections": (v4/*:: as any*/),
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
                (v2/*:: as any*/)
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
};
})();

(node as any).hash = "9526ef7eebd5e08cf32b4037228dd194";

export default node;
