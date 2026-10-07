/**
 * @generated SignedSource<<5263f92e770d3e020695a4782a2886fb>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type Category = "ACCOMMODATION" | "ACTIVITIES" | "DINING" | "GROCERIES" | "HOME" | "OTHER" | "TRANSPORT" | "%future added value";
export type Currency = "USD" | "%future added value";
export type OperationState = "NOT_OBSERVED" | "PENDING" | "UNKNOWN" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
export type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "%future added value";
export type CreateExpenseInput = {
  category: Category;
  currency: Currency;
  description: string;
  effectiveDate: string;
  exactAllocations?: ReadonlyArray<ExactAllocationInput> | null | undefined;
  groupId: string;
  key: string;
  note?: string;
  participantIds: ReadonlyArray<string>;
  payerId: string;
  percentages?: ReadonlyArray<PercentageInput> | null | undefined;
  split: SplitMode;
  totalMinor: string;
};
export type ExactAllocationInput = {
  amountMinor: string;
  participantId: string;
};
export type PercentageInput = {
  hundredths: number;
  participantId: string;
};
export type journeyCreateMutation$variables = {
  input: CreateExpenseInput;
};
export type journeyCreateMutation$data = {
  readonly createExpense: {
    readonly __typename: "ExpenseCommitted";
    readonly key: string;
    readonly record: {
      readonly allocations: ReadonlyArray<{
        readonly amountMinor: string;
        readonly participantId: string;
        readonly percentageHundredths: number | null | undefined;
      }>;
      readonly expenseId: string;
      readonly groupId: string;
      readonly revision: string;
      readonly split: SplitMode;
      readonly totalMinor: string;
    };
  } | {
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
export type journeyCreateMutation = {
  response: journeyCreateMutation$data;
  variables: journeyCreateMutation$variables;
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
    "name": "createExpense",
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
            "concreteType": "ExpenseOperationRecord",
            "kind": "LinkedField",
            "name": "record",
            "plural": false,
            "selections": [
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "expenseId",
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
                "name": "totalMinor",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "revision",
                "storageKey": null
              },
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
                "concreteType": "OperationAllocation",
                "kind": "LinkedField",
                "name": "allocations",
                "plural": true,
                "selections": [
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "participantId",
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
                    "name": "percentageHundredths",
                    "storageKey": null
                  }
                ],
                "storageKey": null
              }
            ],
            "storageKey": null
          }
        ],
        "type": "ExpenseCommitted",
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
    "name": "journeyCreateMutation",
    "selections": (v4/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "journeyCreateMutation",
    "selections": (v4/*:: as any*/)
  },
  "params": {
    "cacheID": "8a82f7bfb395fd227a52f91e4297ddb5",
    "id": null,
    "metadata": {},
    "name": "journeyCreateMutation",
    "operationKind": "mutation",
    "text": "mutation journeyCreateMutation(\n  $input: CreateExpenseInput!\n) {\n  createExpense(input: $input) {\n    __typename\n    ... on ExpenseCommitted {\n      key\n      record {\n        expenseId\n        groupId\n        totalMinor\n        revision\n        split\n        allocations {\n          participantId\n          amountMinor\n          percentageHundredths\n        }\n      }\n    }\n    ... on ValidationProblem {\n      fields {\n        path\n        code\n        message\n      }\n    }\n    ... on OperationMismatch {\n      key\n    }\n    ... on OperationProgress {\n      key\n      state\n    }\n    ... on Problem {\n      code\n      message\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "75a204c1cdc5ba64668fb4d4dce6860c";

export default node;
