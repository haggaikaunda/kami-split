/**
 * @generated SignedSource<<9f62c44d019ac554c8a602243e563ebb>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type AccessState = "DISABLED" | "UNPROVISIONED" | "%future added value";
export type GroupKind = "ORDINARY" | "TRIP" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
export type journeyViewerQuery$variables = Record<PropertyKey, never>;
export type journeyViewerQuery$data = {
  readonly groupDirectory: {
    readonly __typename: "GroupDirectory";
    readonly entries: ReadonlyArray<{
      readonly group: {
        readonly id: string;
        readonly isHousehold: boolean;
        readonly kind: GroupKind;
        readonly trip: {
          readonly endDate: string;
          readonly startDate: string;
        } | null | undefined;
      };
      readonly " $fragmentSpreads": FragmentRefs<"discoveryCard">;
    }>;
  } | {
    readonly __typename: "Problem";
    readonly code: ProblemCode;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
  readonly viewer: {
    readonly __typename: "Problem";
    readonly code: ProblemCode;
    readonly message: string;
  } | {
    readonly __typename: "Viewer";
    readonly canCreateGroups: boolean;
    readonly displayName: string;
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
  "name": "kind",
  "storageKey": null
},
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "isHousehold",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "startDate",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "endDate",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "code",
  "storageKey": null
},
v7 = {
  "kind": "InlineFragment",
  "selections": [
    (v6/*:: as any*/)
  ],
  "type": "Problem",
  "abstractKey": null
},
v8 = {
  "kind": "InlineFragment",
  "selections": [
    (v1/*:: as any*/),
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
      "name": "today",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "canCreateGroups",
      "storageKey": null
    }
  ],
  "type": "Viewer",
  "abstractKey": null
},
v9 = {
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
v10 = {
  "kind": "InlineFragment",
  "selections": [
    (v6/*:: as any*/),
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
        "name": "groupDirectory",
        "plural": false,
        "selections": [
          (v0/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              {
                "alias": null,
                "args": null,
                "concreteType": "GroupDirectoryEntry",
                "kind": "LinkedField",
                "name": "entries",
                "plural": true,
                "selections": [
                  {
                    "args": null,
                    "kind": "FragmentSpread",
                    "name": "discoveryCard"
                  },
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "GroupSummary",
                    "kind": "LinkedField",
                    "name": "group",
                    "plural": false,
                    "selections": [
                      (v1/*:: as any*/),
                      (v2/*:: as any*/),
                      (v3/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "concreteType": "GroupTrip",
                        "kind": "LinkedField",
                        "name": "trip",
                        "plural": false,
                        "selections": [
                          (v4/*:: as any*/),
                          (v5/*:: as any*/)
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
            "type": "GroupDirectory",
            "abstractKey": null
          },
          (v7/*:: as any*/)
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
          (v0/*:: as any*/),
          (v8/*:: as any*/),
          (v9/*:: as any*/),
          (v10/*:: as any*/)
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
        "name": "groupDirectory",
        "plural": false,
        "selections": [
          (v0/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              {
                "alias": null,
                "args": null,
                "concreteType": "GroupDirectoryEntry",
                "kind": "LinkedField",
                "name": "entries",
                "plural": true,
                "selections": [
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "activeMemberCount",
                    "storageKey": null
                  },
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
                      (v7/*:: as any*/)
                    ],
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "GroupSummary",
                    "kind": "LinkedField",
                    "name": "group",
                    "plural": false,
                    "selections": [
                      (v1/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "kind": "ScalarField",
                        "name": "name",
                        "storageKey": null
                      },
                      (v2/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "kind": "ScalarField",
                        "name": "currency",
                        "storageKey": null
                      },
                      (v3/*:: as any*/),
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
                          (v4/*:: as any*/),
                          (v5/*:: as any*/)
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
            "type": "GroupDirectory",
            "abstractKey": null
          },
          (v7/*:: as any*/)
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
          (v0/*:: as any*/),
          (v8/*:: as any*/),
          (v9/*:: as any*/),
          (v10/*:: as any*/),
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
    "cacheID": "fb6f8e9047c2c6258ed7e25fe4be2ec5",
    "id": null,
    "metadata": {},
    "name": "journeyViewerQuery",
    "operationKind": "query",
    "text": "query journeyViewerQuery {\n  groupDirectory {\n    __typename\n    ... on GroupDirectory {\n      entries {\n        ...discoveryCard\n        group {\n          id\n          kind\n          isHousehold\n          trip {\n            startDate\n            endDate\n          }\n        }\n      }\n    }\n    ... on Problem {\n      code\n    }\n  }\n  viewer {\n    __typename\n    ... on Viewer {\n      id\n      displayName\n      today\n      canCreateGroups\n    }\n    ... on ViewerAccess {\n      state\n    }\n    ... on Problem {\n      code\n      message\n    }\n    ... on Node {\n      __isNode: __typename\n      id\n    }\n  }\n}\n\nfragment discoveryCard on GroupDirectoryEntry {\n  activeMemberCount\n  financialSummary {\n    __typename\n    ... on GroupFinancialSummary {\n      totalSpendMinor\n      viewerNetMinor\n    }\n    ... on Problem {\n      code\n    }\n  }\n  group {\n    id\n    name\n    kind\n    currency\n    isHousehold\n    trip {\n      destination\n      startDate\n      endDate\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "6ee3708ab5c4c8587731892eaf369ce4";

export default node;
