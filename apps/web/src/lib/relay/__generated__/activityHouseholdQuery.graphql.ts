/**
 * @generated SignedSource<<2b9f13752c882346f5d02f961e34a8ed>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type ActivityKind = "EXPENSE_CREATED" | "EXPENSE_UPDATED" | "REPAYMENT_RECORDED" | "%future added value";
export type ActivityFilter = {
  kind?: ActivityKind | null | undefined;
  sourceGroupId?: string | null | undefined;
};
export type activityHouseholdQuery$variables = {
  after?: string | null | undefined;
  filter?: ActivityFilter | null | undefined;
};
export type activityHouseholdQuery$data = {
  readonly householdActivity: {
    readonly " $fragmentSpreads": FragmentRefs<"activityFeed">;
  };
};
export type activityHouseholdQuery = {
  response: activityHouseholdQuery$data;
  variables: activityHouseholdQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "after"
  },
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "filter"
  }
],
v1 = [
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
  "name": "description",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "note",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "effectiveDate",
  "storageKey": null
},
v8 = [
  (v4/*:: as any*/),
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "displayName",
    "storageKey": null
  }
],
v9 = {
  "alias": null,
  "args": null,
  "concreteType": "ActivityIdentity",
  "kind": "LinkedField",
  "name": "payer",
  "plural": false,
  "selections": (v8/*:: as any*/),
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "amountMinor",
  "storageKey": null
},
v11 = [
  (v5/*:: as any*/),
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "totalMinor",
    "storageKey": null
  },
  (v7/*:: as any*/),
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "category",
    "storageKey": null
  },
  (v6/*:: as any*/),
  (v9/*:: as any*/),
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
        "selections": (v8/*:: as any*/),
        "storageKey": null
      },
      (v10/*:: as any*/),
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
v12 = {
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
            (v4/*:: as any*/),
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "recordId",
              "storageKey": null
            },
            (v5/*:: as any*/),
            (v6/*:: as any*/),
            {
              "alias": null,
              "args": null,
              "concreteType": "ActivityExpenseSnapshot",
              "kind": "LinkedField",
              "name": "before",
              "plural": false,
              "selections": (v11/*:: as any*/),
              "storageKey": null
            },
            {
              "alias": null,
              "args": null,
              "concreteType": "ActivityExpenseSnapshot",
              "kind": "LinkedField",
              "name": "after",
              "plural": false,
              "selections": (v11/*:: as any*/),
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
              "name": "groupKind",
              "storageKey": null
            },
            (v10/*:: as any*/),
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "currency",
              "storageKey": null
            },
            (v7/*:: as any*/),
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
              "selections": (v8/*:: as any*/),
              "storageKey": null
            },
            (v9/*:: as any*/),
            {
              "alias": null,
              "args": null,
              "concreteType": "ActivityIdentity",
              "kind": "LinkedField",
              "name": "sender",
              "plural": false,
              "selections": (v8/*:: as any*/),
              "storageKey": null
            },
            {
              "alias": null,
              "args": null,
              "concreteType": "ActivityIdentity",
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
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "activityHouseholdQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "householdActivity",
        "plural": false,
        "selections": [
          {
            "kind": "InlineDataFragmentSpread",
            "name": "activityFeed",
            "selections": [
              (v2/*:: as any*/),
              (v3/*:: as any*/),
              (v12/*:: as any*/)
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
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "activityHouseholdQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "householdActivity",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          {
            "kind": "TypeDiscriminator",
            "abstractKey": "__isActivityResult"
          },
          (v3/*:: as any*/),
          (v12/*:: as any*/)
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "6158a9e50630fe7bb03c806b75cee684",
    "id": null,
    "metadata": {},
    "name": "activityHouseholdQuery",
    "operationKind": "query",
    "text": "query activityHouseholdQuery(\n  $after: String\n  $filter: ActivityFilter\n) {\n  householdActivity(first: 20, after: $after, filter: $filter) {\n    __typename\n    ...activityFeed\n  }\n}\n\nfragment activityFeed on ActivityResult {\n  __isActivityResult: __typename\n  __typename\n  ... on Problem {\n    code\n    message\n  }\n  ... on ActivityConnection {\n    edges {\n      cursor\n      node {\n        id\n        recordId\n        description\n        note\n        before {\n          description\n          totalMinor\n          effectiveDate\n          category\n          note\n          payer {\n            id\n            displayName\n          }\n          split\n          allocations {\n            participant {\n              id\n              displayName\n            }\n            amountMinor\n            percentageHundredths\n          }\n        }\n        after {\n          description\n          totalMinor\n          effectiveDate\n          category\n          note\n          payer {\n            id\n            displayName\n          }\n          split\n          allocations {\n            participant {\n              id\n              displayName\n            }\n            amountMinor\n            percentageHundredths\n          }\n        }\n        kind\n        groupId\n        groupName\n        isHousehold\n        groupKind\n        amountMinor\n        currency\n        effectiveDate\n        timestamp\n        creator {\n          id\n          displayName\n        }\n        payer {\n          id\n          displayName\n        }\n        sender {\n          id\n          displayName\n        }\n        recipient {\n          id\n          displayName\n        }\n      }\n    }\n    pageInfo {\n      hasNextPage\n      endCursor\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "8d94eb863077544363bd582db3834998";

export default node;
