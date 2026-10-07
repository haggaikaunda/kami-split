/**
 * @generated SignedSource<<33290784a0fec9182397fcd5bc1c117c>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type GroupKind = "ORDINARY" | "TRIP" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
export type CreateGroupInput = {
  kind: GroupKind;
  name: string;
  operationKey: string;
  trip?: GroupTripInput | null | undefined;
};
export type GroupTripInput = {
  destination?: string | null | undefined;
  endDate: string;
  startDate: string;
};
export type journeyGroupCreationMutation$variables = {
  input: CreateGroupInput;
};
export type journeyGroupCreationMutation$data = {
  readonly createGroup: {
    readonly __typename: "GroupCreationCompleted";
    readonly createdAt: string;
    readonly creatorMembershipId: string;
    readonly groupId: string;
    readonly operationKey: string;
  } | {
    readonly __typename: "GroupCreationConflict";
    readonly operationKey: string;
  } | {
    readonly __typename: "GroupCreationRejected";
    readonly fields: ReadonlyArray<{
      readonly code: string;
      readonly message: string;
      readonly path: ReadonlyArray<string>;
    }>;
    readonly operationKey: string;
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
export type journeyGroupCreationMutation = {
  response: journeyGroupCreationMutation$data;
  variables: journeyGroupCreationMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "input"
  }
],
v1 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "operationKey",
  "storageKey": null
},
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "code",
  "storageKey": null
},
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "message",
  "storageKey": null
},
v4 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "input",
        "variableName": "input"
      }
    ],
    "concreteType": null,
    "kind": "LinkedField",
    "name": "createGroup",
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
          (v1/*:: as any*/),
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
            "name": "creatorMembershipId",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "createdAt",
            "storageKey": null
          }
        ],
        "type": "GroupCreationCompleted",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": [
          (v1/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "concreteType": "FieldProblem",
            "kind": "LinkedField",
            "name": "fields",
            "plural": true,
            "selections": [
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "path",
                "storageKey": null
              },
              (v2/*:: as any*/),
              (v3/*:: as any*/)
            ],
            "storageKey": null
          }
        ],
        "type": "GroupCreationRejected",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": [
          (v1/*:: as any*/)
        ],
        "type": "GroupCreationConflict",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": [
          (v2/*:: as any*/),
          (v3/*:: as any*/)
        ],
        "type": "Problem",
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
    "name": "journeyGroupCreationMutation",
    "selections": (v4/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "journeyGroupCreationMutation",
    "selections": (v4/*:: as any*/)
  },
  "params": {
    "cacheID": "c0cf1e50bd7472c659e62ed1f3b38274",
    "id": null,
    "metadata": {},
    "name": "journeyGroupCreationMutation",
    "operationKind": "mutation",
    "text": "mutation journeyGroupCreationMutation(\n  $input: CreateGroupInput!\n) {\n  createGroup(input: $input) {\n    __typename\n    ... on GroupCreationCompleted {\n      operationKey\n      groupId\n      creatorMembershipId\n      createdAt\n    }\n    ... on GroupCreationRejected {\n      operationKey\n      fields {\n        path\n        code\n        message\n      }\n    }\n    ... on GroupCreationConflict {\n      operationKey\n    }\n    ... on Problem {\n      code\n      message\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "5d46a02321202e89c6592f78513b9dbe";

export default node;
