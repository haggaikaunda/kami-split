/**
 * @generated SignedSource<<39c0c3bfc8249107af182802af50b038>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type Currency = "USD" | "%future added value";
export type OperationState = "NOT_OBSERVED" | "PENDING" | "UNKNOWN" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
export type RecordRepaymentInput = {
  amountMinor: string;
  currency: Currency;
  effectiveDate: string;
  groupId: string;
  key: string;
  note?: string;
  recipientId: string;
  senderId: string;
};
export type journeyRepaymentMutation$variables = {
  input: RecordRepaymentInput;
};
export type journeyRepaymentMutation$data = {
  readonly recordRepayment: {
    readonly __typename: "OperationMismatch";
    readonly key: string;
  } | {
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
export type journeyRepaymentMutation = {
  response: journeyRepaymentMutation$data;
  variables: journeyRepaymentMutation$variables;
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
    "name": "recordRepayment",
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
          (v1/*:: as any*/)
        ],
        "type": "OperationMismatch",
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
];
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "journeyRepaymentMutation",
    "selections": (v4/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "journeyRepaymentMutation",
    "selections": (v4/*:: as any*/)
  },
  "params": {
    "cacheID": "b3df1e9a5cce39c5bf8cf654b4b8c24b",
    "id": null,
    "metadata": {},
    "name": "journeyRepaymentMutation",
    "operationKind": "mutation",
    "text": "mutation journeyRepaymentMutation(\n  $input: RecordRepaymentInput!\n) {\n  recordRepayment(input: $input) {\n    __typename\n    ... on RepaymentCommitted {\n      key\n      record {\n        repaymentId\n        groupId\n        senderMembershipId\n        recipientMembershipId\n        amountMinor\n        currency\n        effectiveDate\n        note\n      }\n    }\n    ... on ValidationProblem {\n      fields {\n        path\n        code\n        message\n      }\n    }\n    ... on OperationMismatch {\n      key\n    }\n    ... on OperationProgress {\n      key\n      state\n    }\n    ... on Problem {\n      code\n      message\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "c8cbeed3192a97f0613541af228752ac";

export default node;
