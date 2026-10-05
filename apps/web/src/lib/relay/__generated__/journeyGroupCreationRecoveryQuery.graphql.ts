/**
 * @generated SignedSource<<70e2c212f72f5f2d1481ccb071d5e3c5>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
export type journeyGroupCreationRecoveryQuery$variables = {
  operationKey: string;
};
export type journeyGroupCreationRecoveryQuery$data = {
  readonly groupCreationOperation: {
    readonly __typename: "GroupCreationCompleted";
    readonly createdAt: string;
    readonly creatorMembershipId: string;
    readonly groupId: string;
    readonly operationKey: string;
  } | {
    readonly __typename: "GroupCreationNotStarted";
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
export type journeyGroupCreationRecoveryQuery = {
  response: journeyGroupCreationRecoveryQuery$data;
  variables: journeyGroupCreationRecoveryQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "operationKey"
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
        "name": "operationKey",
        "variableName": "operationKey"
      }
    ],
    "concreteType": null,
    "kind": "LinkedField",
    "name": "groupCreationOperation",
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
        "type": "GroupCreationNotStarted",
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
    "name": "journeyGroupCreationRecoveryQuery",
    "selections": (v4/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "journeyGroupCreationRecoveryQuery",
    "selections": (v4/*:: as any*/)
  },
  "params": {
    "cacheID": "a8beea3cb2db6b56c57612b6bf6d899a",
    "id": null,
    "metadata": {},
    "name": "journeyGroupCreationRecoveryQuery",
    "operationKind": "query",
    "text": "query journeyGroupCreationRecoveryQuery(\n  $operationKey: OperationKey!\n) {\n  groupCreationOperation(operationKey: $operationKey) {\n    __typename\n    ... on GroupCreationCompleted {\n      operationKey\n      groupId\n      creatorMembershipId\n      createdAt\n    }\n    ... on GroupCreationRejected {\n      operationKey\n      fields {\n        path\n        code\n        message\n      }\n    }\n    ... on GroupCreationNotStarted {\n      operationKey\n    }\n    ... on Problem {\n      code\n      message\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "1f31fd3610f7d0d7109ebf584c101926";

export default node;
