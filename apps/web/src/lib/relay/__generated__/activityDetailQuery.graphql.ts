/**
 * @generated SignedSource<<7236701b26aa3d056691b66116aead4a>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type ActivityKind = "EXPENSE_CREATED" | "EXPENSE_UPDATED" | "REPAYMENT_RECORDED" | "%future added value";
export type Category = "ACCOMMODATION" | "ACTIVITIES" | "DINING" | "GROCERIES" | "HOME" | "OTHER" | "TRANSPORT" | "%future added value";
export type Currency = "USD" | "%future added value";
export type GroupKind = "ORDINARY" | "TRIP" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
export type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "%future added value";
export type activityDetailQuery$variables = {
  eventId: string;
  groupId?: string | null | undefined;
};
export type activityDetailQuery$data = {
  readonly activityEvent: {
    readonly __typename: "ActivityEvent";
    readonly after: {
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
      readonly note: string;
      readonly payer: {
        readonly displayName: string;
        readonly id: string;
      };
      readonly split: SplitMode;
      readonly totalMinor: string;
    } | null | undefined;
    readonly amountMinor: string;
    readonly before: {
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
      readonly note: string;
      readonly payer: {
        readonly displayName: string;
        readonly id: string;
      };
      readonly split: SplitMode;
      readonly totalMinor: string;
    } | null | undefined;
    readonly creator: {
      readonly displayName: string;
      readonly id: string;
    };
    readonly currency: Currency;
    readonly description: string;
    readonly effectiveDate: string;
    readonly groupId: string;
    readonly groupKind: GroupKind;
    readonly groupName: string;
    readonly id: string;
    readonly isHousehold: boolean;
    readonly kind: ActivityKind;
    readonly note: string;
    readonly payer: {
      readonly displayName: string;
      readonly id: string;
    } | null | undefined;
    readonly recipient: {
      readonly displayName: string;
      readonly id: string;
    } | null | undefined;
    readonly recordId: string;
    readonly sender: {
      readonly displayName: string;
      readonly id: string;
    } | null | undefined;
    readonly timestamp: string;
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
export type activityDetailQuery = {
  response: activityDetailQuery$data;
  variables: activityDetailQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "eventId"
  },
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "groupId"
  }
],
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
  "name": "amountMinor",
  "storageKey": null
},
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "effectiveDate",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "description",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "note",
  "storageKey": null
},
v6 = [
  (v1/*:: as any*/),
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "displayName",
    "storageKey": null
  }
],
v7 = {
  "alias": null,
  "args": null,
  "concreteType": "ActivityIdentity",
  "kind": "LinkedField",
  "name": "payer",
  "plural": false,
  "selections": (v6/*:: as any*/),
  "storageKey": null
},
v8 = [
  (v4/*:: as any*/),
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "totalMinor",
    "storageKey": null
  },
  (v3/*:: as any*/),
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "category",
    "storageKey": null
  },
  (v5/*:: as any*/),
  (v7/*:: as any*/),
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
        "selections": (v6/*:: as any*/),
        "storageKey": null
      },
      (v2/*:: as any*/),
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
v9 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "eventId",
        "variableName": "eventId"
      },
      {
        "kind": "Variable",
        "name": "groupId",
        "variableName": "groupId"
      }
    ],
    "concreteType": null,
    "kind": "LinkedField",
    "name": "activityEvent",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "__typename",
        "storageKey": null
      },
      {
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
      {
        "kind": "InlineFragment",
        "selections": [
          (v1/*:: as any*/),
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
            "name": "groupKind",
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
            "kind": "ScalarField",
            "name": "timestamp",
            "storageKey": null
          },
          (v4/*:: as any*/),
          (v5/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "concreteType": "ActivityIdentity",
            "kind": "LinkedField",
            "name": "creator",
            "plural": false,
            "selections": (v6/*:: as any*/),
            "storageKey": null
          },
          (v7/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "concreteType": "ActivityIdentity",
            "kind": "LinkedField",
            "name": "sender",
            "plural": false,
            "selections": (v6/*:: as any*/),
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "ActivityIdentity",
            "kind": "LinkedField",
            "name": "recipient",
            "plural": false,
            "selections": (v6/*:: as any*/),
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "ActivityExpenseSnapshot",
            "kind": "LinkedField",
            "name": "before",
            "plural": false,
            "selections": (v8/*:: as any*/),
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "ActivityExpenseSnapshot",
            "kind": "LinkedField",
            "name": "after",
            "plural": false,
            "selections": (v8/*:: as any*/),
            "storageKey": null
          }
        ],
        "type": "ActivityEvent",
        "abstractKey": null
      }
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "activityDetailQuery",
    "selections": (v9/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "activityDetailQuery",
    "selections": (v9/*:: as any*/)
  },
  "params": {
    "cacheID": "a2673ccfe03052d56b6468cbce08792b",
    "id": null,
    "metadata": {},
    "name": "activityDetailQuery",
    "operationKind": "query",
    "text": "query activityDetailQuery(\n  $eventId: ID!\n  $groupId: ID\n) {\n  activityEvent(eventId: $eventId, groupId: $groupId) {\n    __typename\n    ... on Problem {\n      code\n      message\n    }\n    ... on ActivityEvent {\n      id\n      recordId\n      kind\n      groupId\n      groupName\n      isHousehold\n      groupKind\n      amountMinor\n      currency\n      effectiveDate\n      timestamp\n      description\n      note\n      creator {\n        id\n        displayName\n      }\n      payer {\n        id\n        displayName\n      }\n      sender {\n        id\n        displayName\n      }\n      recipient {\n        id\n        displayName\n      }\n      before {\n        description\n        totalMinor\n        effectiveDate\n        category\n        note\n        payer {\n          id\n          displayName\n        }\n        split\n        allocations {\n          participant {\n            id\n            displayName\n          }\n          amountMinor\n          percentageHundredths\n        }\n      }\n      after {\n        description\n        totalMinor\n        effectiveDate\n        category\n        note\n        payer {\n          id\n          displayName\n        }\n        split\n        allocations {\n          participant {\n            id\n            displayName\n          }\n          amountMinor\n          percentageHundredths\n        }\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "021cc0cf8e58643b89ff10e5d5e8a34d";

export default node;
