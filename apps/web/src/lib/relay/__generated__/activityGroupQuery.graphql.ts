/**
 * @generated SignedSource<<4ef2fed2ac290b820e8d636dbf14d843>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type ActivityKind = "EXPENSE_CREATED" | "REPAYMENT_RECORDED" | "%future added value";
export type ActivityFilter = {
  kind?: ActivityKind | null | undefined;
  sourceGroupId?: string | null | undefined;
};
export type activityGroupQuery$variables = {
  after?: string | null | undefined;
  filter?: ActivityFilter | null | undefined;
  groupId: string;
};
export type activityGroupQuery$data = {
  readonly groupActivity: {
    readonly " $fragmentSpreads": FragmentRefs<"activityFeed">;
  };
};
export type activityGroupQuery = {
  response: activityGroupQuery$data;
  variables: activityGroupQuery$variables;
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
  "name": "filter"
},
v2 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "groupId"
},
v3 = [
  {
    "kind": "Variable",
    "name": "after",
    "variableName": "after"
  },
  {
    "kind": "Variable",
    "name": "filter",
    "variableName": "filter"
  },
  {
    "kind": "Literal",
    "name": "first",
    "value": 20
  },
  {
    "kind": "Variable",
    "name": "groupId",
    "variableName": "groupId"
  }
],
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "__typename",
  "storageKey": null
},
v5 = {
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
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v7 = [
  (v6/*:: as any*/),
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "displayName",
    "storageKey": null
  }
],
v8 = {
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
          "kind": "ScalarField",
          "name": "cursor",
          "storageKey": null
        },
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
              "kind": "ScalarField",
              "name": "recordId",
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
              "name": "groupId",
              "storageKey": null
            },
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "groupName",
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
              "name": "amountMinor",
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
              "name": "effectiveDate",
              "storageKey": null
            },
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
              "selections": (v7/*:: as any*/),
              "storageKey": null
            },
            {
              "alias": null,
              "args": null,
              "concreteType": "ActivityIdentity",
              "kind": "LinkedField",
              "name": "payer",
              "plural": false,
              "selections": (v7/*:: as any*/),
              "storageKey": null
            },
            {
              "alias": null,
              "args": null,
              "concreteType": "ActivityIdentity",
              "kind": "LinkedField",
              "name": "sender",
              "plural": false,
              "selections": (v7/*:: as any*/),
              "storageKey": null
            },
            {
              "alias": null,
              "args": null,
              "concreteType": "ActivityIdentity",
              "kind": "LinkedField",
              "name": "recipient",
              "plural": false,
              "selections": (v7/*:: as any*/),
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
  "type": "ActivityConnection",
  "abstractKey": null
};
return {
  "fragment": {
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/),
      (v2/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "activityGroupQuery",
    "selections": [
      {
        "alias": null,
        "args": (v3/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "groupActivity",
        "plural": false,
        "selections": [
          {
            "kind": "InlineDataFragmentSpread",
            "name": "activityFeed",
            "selections": [
              (v4/*:: as any*/),
              (v5/*:: as any*/),
              (v8/*:: as any*/)
            ],
            "args": null,
            "argumentDefinitions": []
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
      (v2/*:: as any*/),
      (v0/*:: as any*/),
      (v1/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "activityGroupQuery",
    "selections": [
      {
        "alias": null,
        "args": (v3/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "groupActivity",
        "plural": false,
        "selections": [
          (v4/*:: as any*/),
          {
            "kind": "TypeDiscriminator",
            "abstractKey": "__isActivityResult"
          },
          (v5/*:: as any*/),
          (v8/*:: as any*/)
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "87adc8dab84bcdedb74dabd7e2c1ade8",
    "id": null,
    "metadata": {},
    "name": "activityGroupQuery",
    "operationKind": "query",
    "text": "query activityGroupQuery(\n  $groupId: ID!\n  $after: String\n  $filter: ActivityFilter\n) {\n  groupActivity(groupId: $groupId, first: 20, after: $after, filter: $filter) {\n    __typename\n    ...activityFeed\n  }\n}\n\nfragment activityFeed on ActivityResult {\n  __isActivityResult: __typename\n  __typename\n  ... on Problem {\n    code\n    message\n  }\n  ... on ActivityConnection {\n    edges {\n      cursor\n      node {\n        id\n        recordId\n        kind\n        groupId\n        groupName\n        isHousehold\n        amountMinor\n        currency\n        effectiveDate\n        timestamp\n        creator {\n          id\n          displayName\n        }\n        payer {\n          id\n          displayName\n        }\n        sender {\n          id\n          displayName\n        }\n        recipient {\n          id\n          displayName\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "b688379fed5c0080982ef86bc7dbbffd";

export default node;
