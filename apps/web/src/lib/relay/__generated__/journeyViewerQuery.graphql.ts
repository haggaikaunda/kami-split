/**
 * @generated SignedSource<<51f2eaf3f5f9c4313e006be594b00b14>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type AccessState = "DISABLED" | "UNPROVISIONED" | "%future added value";
export type Currency = "USD" | "%future added value";
export type GroupKind = "ORDINARY" | "TRIP" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
export type journeyViewerQuery$variables = Record<PropertyKey, never>;
export type journeyViewerQuery$data = {
  readonly viewer: {
    readonly __typename: "Problem";
    readonly code: ProblemCode;
    readonly message: string;
  } | {
    readonly __typename: "Viewer";
    readonly canCreateGroups: boolean;
    readonly displayName: string;
    readonly groups: ReadonlyArray<{
      readonly currency: Currency;
      readonly id: string;
      readonly isHousehold: boolean;
      readonly kind: GroupKind;
      readonly trip: {
        readonly endDate: string;
        readonly startDate: string;
      } | null | undefined;
      readonly " $fragmentSpreads": FragmentRefs<"discoveryCard">;
    }>;
    readonly id: string;
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
export type journeyViewerQuery = {
  response: journeyViewerQuery$data;
  variables: journeyViewerQuery$variables;
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
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
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
  "name": "today",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "canCreateGroups",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "currency",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "kind",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "isHousehold",
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "startDate",
  "storageKey": null
},
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "endDate",
  "storageKey": null
},
v10 = {
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
v11 = {
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
};
return {
  "fragment": {
    "argumentDefinitions": [],
    "kind": "Fragment",
    "metadata": null,
    "name": "journeyViewerQuery",
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
          {
            "kind": "InlineFragment",
            "selections": [
              (v1/*:: as any*/),
              (v2/*:: as any*/),
              (v3/*:: as any*/),
              (v4/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "GroupSummary",
                "kind": "LinkedField",
                "name": "groups",
                "plural": true,
                "selections": [
                  {
                    "args": null,
                    "kind": "FragmentSpread",
                    "name": "discoveryCard"
                  },
                  (v1/*:: as any*/),
                  (v5/*:: as any*/),
                  (v6/*:: as any*/),
                  (v7/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "GroupTrip",
                    "kind": "LinkedField",
                    "name": "trip",
                    "plural": false,
                    "selections": [
                      (v8/*:: as any*/),
                      (v9/*:: as any*/)
                    ],
                    "storageKey": null
                  }
                ],
                "storageKey": null
              }
            ],
            "type": "Viewer",
            "abstractKey": null
          },
          (v10/*:: as any*/),
          (v11/*:: as any*/)
        ],
        "storageKey": null
      }
    ],
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "journeyViewerQuery",
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
          {
            "kind": "InlineFragment",
            "selections": [
              (v1/*:: as any*/),
              (v2/*:: as any*/),
              (v3/*:: as any*/),
              (v4/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "GroupSummary",
                "kind": "LinkedField",
                "name": "groups",
                "plural": true,
                "selections": [
                  (v1/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "name",
                    "storageKey": null
                  },
                  (v6/*:: as any*/),
                  (v7/*:: as any*/),
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
                      (v8/*:: as any*/),
                      (v9/*:: as any*/)
                    ],
                    "storageKey": null
                  },
                  (v5/*:: as any*/)
                ],
                "storageKey": null
              }
            ],
            "type": "Viewer",
            "abstractKey": null
          },
          (v10/*:: as any*/),
          (v11/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v1/*:: as any*/)
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
    "cacheID": "3bc8da38375a6a7ba99c20047da8c848",
    "id": null,
    "metadata": {},
    "name": "journeyViewerQuery",
    "operationKind": "query",
    "text": "query journeyViewerQuery {\n  viewer {\n    __typename\n    ... on Viewer {\n      id\n      displayName\n      today\n      canCreateGroups\n      groups {\n        ...discoveryCard\n        id\n        currency\n        kind\n        isHousehold\n        trip {\n          startDate\n          endDate\n        }\n      }\n    }\n    ... on ViewerAccess {\n      state\n    }\n    ... on Problem {\n      code\n      message\n    }\n    ... on Node {\n      __isNode: __typename\n      id\n    }\n  }\n}\n\nfragment discoveryCard on GroupSummary {\n  id\n  name\n  kind\n  isHousehold\n  trip {\n    destination\n    startDate\n    endDate\n  }\n}\n"
  }
};
})();

(node as any).hash = "27d51f3b3fe64bec7e0b06fa7bac8aaf";

export default node;
