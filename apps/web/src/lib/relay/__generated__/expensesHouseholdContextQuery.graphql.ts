/**
 * @generated SignedSource<<e0a432a1367c03c08e679c5c657278dd>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type Currency = "USD" | "%future added value";
export type HouseholdDashboardState = "COMPLETE" | "INCOMPLETE" | "UNAVAILABLE" | "%future added value";
export type MembershipRole = "MEMBER" | "OWNER" | "%future added value";
export type MembershipStatus = "ACTIVE" | "INACTIVE" | "%future added value";
export type expensesHouseholdContextQuery$variables = Record<PropertyKey, never>;
export type expensesHouseholdContextQuery$data = {
  readonly householdDashboard: {
    readonly __typename: "HouseholdDashboard";
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
  readonly viewer: {
    readonly __typename: "Viewer";
    readonly today: string;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
};
export type expensesHouseholdContextQuery = {
  response: expensesHouseholdContextQuery$data;
  variables: expensesHouseholdContextQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "__typename",
  "storageKey": null
},
v1 = {
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
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "viewerNetMinor",
  "storageKey": null
},
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v4 = [
  (v3/*:: as any*/)
],
v5 = {
  "alias": null,
  "args": null,
  "concreteType": null,
  "kind": "LinkedField",
  "name": "householdDashboard",
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
                (v2/*:: as any*/),
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
              "name": "currency",
              "storageKey": null
            },
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "isHousehold",
              "storageKey": null
            },
            (v2/*:: as any*/),
            {
              "alias": null,
              "args": null,
              "concreteType": "Membership",
              "kind": "LinkedField",
              "name": "viewerMembership",
              "plural": false,
              "selections": (v4/*:: as any*/),
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
    "argumentDefinitions": [],
    "kind": "Fragment",
    "metadata": null,
    "name": "expensesHouseholdContextQuery",
    "selections": [
      {
        "alias": null,
        "args": null,
        "concreteType": null,
        "kind": "LinkedField",
        "name": "viewer",
        "plural": false,
        "selections": [
          (v0/*:: as any*/),
          (v1/*:: as any*/)
        ],
        "storageKey": null
      },
      (v5/*:: as any*/)
    ],
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "expensesHouseholdContextQuery",
    "selections": [
      {
        "alias": null,
        "args": null,
        "concreteType": null,
        "kind": "LinkedField",
        "name": "viewer",
        "plural": false,
        "selections": [
          (v0/*:: as any*/),
          (v1/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": (v4/*:: as any*/),
            "type": "Node",
            "abstractKey": "__isNode"
          }
        ],
        "storageKey": null
      },
      (v5/*:: as any*/)
    ]
  },
  "params": {
    "cacheID": "c3e1b5212f759914aaa3f82d8c813f08",
    "id": null,
    "metadata": {},
    "name": "expensesHouseholdContextQuery",
    "operationKind": "query",
    "text": "query expensesHouseholdContextQuery {\n  viewer {\n    __typename\n    ... on Viewer {\n      today\n    }\n    ... on Node {\n      __isNode: __typename\n      id\n    }\n  }\n  householdDashboard {\n    __typename\n    ... on HouseholdDashboard {\n      state\n      totals {\n        __typename\n        ... on HouseholdDashboardTotals {\n          viewerNetMinor\n          activeSpaceCount\n        }\n      }\n      spaces {\n        groupId\n        name\n        currency\n        isHousehold\n        viewerNetMinor\n        viewerMembership {\n          id\n        }\n        members {\n          id\n          displayName\n          status\n          role\n          canParticipate\n        }\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "a48f10b8c1aab18dc7a596e5c9c05981";

export default node;
