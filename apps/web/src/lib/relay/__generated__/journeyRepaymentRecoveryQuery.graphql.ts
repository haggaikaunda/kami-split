/**
 * @generated SignedSource<<41980d4e7d2bf945b6fc9f88000f68bf>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type Currency = "USD" | "%future added value";
export type OperationState = "NOT_OBSERVED" | "PENDING" | "UNKNOWN" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
export type journeyRepaymentRecoveryQuery$variables = {
  groupId: string;
  key: string;
};
export type journeyRepaymentRecoveryQuery$data = {
  readonly repaymentOperation: {
    readonly __typename: "OperationProgress";
    readonly key: string;
    readonly state: OperationState;
  } | {
    readonly __typename: "Problem";
    readonly code: ProblemCode;
    readonly message: string;
  } | {
    readonly __typename: "RepaymentCommitted";
    readonly key: string;
    readonly record: {
      readonly amountMinor: string;
      readonly currency: Currency;
      readonly effectiveDate: string;
      readonly groupId: string;
      readonly note: string;
      readonly recipientMembershipId: string;
      readonly repaymentId: string;
      readonly senderMembershipId: string;
    };
  } | {
    readonly __typename: "ValidationProblem";
    readonly fields: ReadonlyArray<{
      readonly code: string;
      readonly message: string;
      readonly path: ReadonlyArray<string>;
    }>;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
};
export type journeyRepaymentRecoveryQuery = {
  response: journeyRepaymentRecoveryQuery$data;
  variables: journeyRepaymentRecoveryQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "groupId"
  },
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "key"
  }
],
v1 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "key",
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
    "kind": "ClientExtension",
    "selections": [
      {
        "alias": null,
        "args": [
          {
            "kind": "Variable",
            "name": "groupId",
            "variableName": "groupId"
          },
          {
            "kind": "Variable",
            "name": "key",
            "variableName": "key"
          }
        ],
        "concreteType": null,
        "kind": "LinkedField",
        "name": "repaymentOperation",
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
                "concreteType": "RepaymentOperationRecord",
                "kind": "LinkedField",
                "name": "record",
                "plural": false,
                "selections": [
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "repaymentId",
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
                    "name": "senderMembershipId",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "recipientMembershipId",
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
                    "name": "note",
                    "storageKey": null
                  }
                ],
                "storageKey": null
              }
            ],
            "type": "RepaymentCommitted",
            "abstractKey": null
          },
          {
            "kind": "InlineFragment",
            "selections": [
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
            "type": "ValidationProblem",
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
                "name": "state",
                "storageKey": null
              }
            ],
            "type": "OperationProgress",
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
    ]
  }
];
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "journeyRepaymentRecoveryQuery",
    "selections": (v4/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "journeyRepaymentRecoveryQuery",
    "selections": (v4/*:: as any*/)
  },
  "params": {
    "cacheID": "b98ff3090e313692f85311e5216088f5",
    "id": null,
    "metadata": {},
    "name": "journeyRepaymentRecoveryQuery",
    "operationKind": "query",
    "text": null
  }
};
})();

(node as any).hash = "890e051340f5d10a77df4198e37fd0c1";

export default node;
