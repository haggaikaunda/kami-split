/**
 * @generated SignedSource<<d8eb6a7d59e2fe1744f220ba0d48de66>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type Category = "ACCOMMODATION" | "ACTIVITIES" | "DINING" | "GROCERIES" | "HOME" | "OTHER" | "TRANSPORT" | "%future added value";
export type Currency = "USD" | "%future added value";
export type ExpenseEditLockReason = "FORMER_MEMBER" | "INELIGIBLE_MEMBER" | "%future added value";
export type OperationState = "NOT_OBSERVED" | "PENDING" | "UNKNOWN" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
export type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "%future added value";
export type UpdateExpenseInput = {
  category: Category;
  currency: Currency;
  description: string;
  effectiveDate: string;
  exactAllocations?: ReadonlyArray<ExactAllocationInput> | null | undefined;
  expectedVersion: string;
  expenseId: string;
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
export type expenseEditMutation$variables = {
  input: UpdateExpenseInput;
};
export type expenseEditMutation$data = {
  readonly updateExpense: {
    readonly __typename: "ExpenseEditCommitted";
    readonly changed: boolean;
    readonly key: string;
    readonly record: {
      readonly expenseId: string;
      readonly groupId: string;
      readonly totalMinor: string;
    };
    readonly version: string;
  } | {
    readonly __typename: "ExpenseEditConflict";
    readonly currentVersion: string;
    readonly key: string;
  } | {
    readonly __typename: "ExpenseEditLocked";
    readonly key: string;
    readonly reason: ExpenseEditLockReason;
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
export type expenseEditMutation = {
  response: expenseEditMutation$data;
  variables: expenseEditMutation$variables;
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
    "name": "updateExpense",
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
            "name": "version",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "changed",
            "storageKey": null
          },
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
              }
            ],
            "storageKey": null
          }
        ],
        "type": "ExpenseEditCommitted",
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
            "name": "currentVersion",
            "storageKey": null
          }
        ],
        "type": "ExpenseEditConflict",
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
            "name": "reason",
            "storageKey": null
          }
        ],
        "type": "ExpenseEditLocked",
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
    "name": "expenseEditMutation",
    "selections": (v4/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "expenseEditMutation",
    "selections": (v4/*:: as any*/)
  },
  "params": {
    "cacheID": "eda65f41f149eb19a9f7b37cbf4052e6",
    "id": null,
    "metadata": {},
    "name": "expenseEditMutation",
    "operationKind": "mutation",
    "text": "mutation expenseEditMutation(\n  $input: UpdateExpenseInput!\n) {\n  updateExpense(input: $input) {\n    __typename\n    ... on ExpenseEditCommitted {\n      key\n      version\n      changed\n      record {\n        expenseId\n        groupId\n        totalMinor\n      }\n    }\n    ... on ExpenseEditConflict {\n      key\n      currentVersion\n    }\n    ... on ExpenseEditLocked {\n      key\n      reason\n    }\n    ... on ValidationProblem {\n      fields {\n        path\n        code\n        message\n      }\n    }\n    ... on OperationMismatch {\n      key\n    }\n    ... on OperationProgress {\n      key\n      state\n    }\n    ... on Problem {\n      code\n      message\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "2e676997efe6130161a9e05be52a92ba";

export default node;
