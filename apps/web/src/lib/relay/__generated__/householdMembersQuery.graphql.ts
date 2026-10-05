/**
 * @generated SignedSource<<d3dd7facc3f3de36d2b3a243622c413f>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type MembershipRole = "MEMBER" | "OWNER" | "%future added value";
export type MembershipStatus = "ACTIVE" | "INACTIVE" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
export type householdMembersQuery$variables = {
  id: string;
};
export type householdMembersQuery$data = {
  readonly group: {
    readonly __typename: "Group";
    readonly id: string;
    readonly members: ReadonlyArray<{
      readonly displayName: string;
      readonly id: string;
      readonly role: MembershipRole;
      readonly status: MembershipStatus;
    }>;
    readonly viewerMembership: {
      readonly role: MembershipRole;
    };
  } | {
    readonly __typename: "Problem";
    readonly code: ProblemCode;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
};
export type householdMembersQuery = {
  response: householdMembersQuery$data;
  variables: householdMembersQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "id"
  }
],
v1 = [
  {
    "kind": "Variable",
    "name": "id",
    "variableName": "id"
  }
],
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
  "name": "id",
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
  "concreteType": "Membership",
  "kind": "LinkedField",
  "name": "members",
  "plural": true,
  "selections": [
    (v4/*:: as any*/),
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "displayName",
      "storageKey": null
    },
    (v5/*:: as any*/),
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "status",
      "storageKey": null
    }
  ],
  "storageKey": null
};
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "householdMembersQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "group",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          (v3/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v4/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "Membership",
                "kind": "LinkedField",
                "name": "viewerMembership",
                "plural": false,
                "selections": [
                  (v5/*:: as any*/)
                ],
                "storageKey": null
              },
              (v6/*:: as any*/)
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
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "householdMembersQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "group",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          (v3/*:: as any*/),
          {
            "kind": "InlineFragment",
            "selections": [
              (v4/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "Membership",
                "kind": "LinkedField",
                "name": "viewerMembership",
                "plural": false,
                "selections": [
                  (v5/*:: as any*/),
                  (v4/*:: as any*/)
                ],
                "storageKey": null
              },
              (v6/*:: as any*/)
            ],
            "type": "Group",
            "abstractKey": null
          },
          {
            "kind": "InlineFragment",
            "selections": [
              (v4/*:: as any*/)
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
    "cacheID": "e9ce20b9037b360e7ad540513aac65d0",
    "id": null,
    "metadata": {},
    "name": "householdMembersQuery",
    "operationKind": "query",
    "text": "query householdMembersQuery(\n  $id: ID!\n) {\n  group(id: $id) {\n    __typename\n    ... on Problem {\n      code\n    }\n    ... on Group {\n      id\n      viewerMembership {\n        role\n        id\n      }\n      members {\n        id\n        displayName\n        role\n        status\n      }\n    }\n    ... on Node {\n      __isNode: __typename\n      id\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "fdb1ad7f6065c6dc2c9672cc839cf72f";

export default node;
