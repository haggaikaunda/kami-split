/**
 * @generated SignedSource<<3ad749eaf3e961ba459089f302755735>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type BankingReplacementAction = "ACTIVATE" | "CHANGE_BOUNDARY" | "RESTORE_PREDECESSOR" | "%future added value";
export type ConfirmBankingReplacementInput = {
  attemptId: string;
  expected: BankingReplacementRevisionsInput;
  request: BankingReplacementRequest;
};
export type BankingReplacementRequest = {
  accountId: string;
  action: BankingReplacementAction;
  bindingId?: string | null | undefined;
  transitionDate?: string | null | undefined;
};
export type BankingReplacementRevisionsInput = {
  annotation: string;
  data: string;
  import: string;
  lifecycle: string;
  plan: string;
};
export type managementCancelMutation$variables = {
  input: ConfirmBankingReplacementInput;
};
export type managementCancelMutation$data = {
  readonly cancelBankingReplacement: {
    readonly __typename: "BankingReplacementResult";
    readonly code: string;
    readonly resultId: string | null | undefined;
  };
};
export type managementCancelMutation = {
  response: managementCancelMutation$data;
  variables: managementCancelMutation$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "input"
  }
],
v1 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "input",
        "variableName": "input"
      }
    ],
    "concreteType": "BankingReplacementResult",
    "kind": "LinkedField",
    "name": "cancelBankingReplacement",
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
        "name": "resultId",
        "storageKey": null
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
    "name": "managementCancelMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "managementCancelMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "d4dad0dd631befb2e90fcff538ba39a1",
    "id": null,
    "metadata": {},
    "name": "managementCancelMutation",
    "operationKind": "mutation",
    "text": "mutation managementCancelMutation(\n  $input: ConfirmBankingReplacementInput!\n) {\n  cancelBankingReplacement(input: $input) {\n    __typename\n    code\n    resultId\n  }\n}\n"
  }
};
})();

(node as any).hash = "75679754f1e1095d90be1a02f76080f9";

export default node;
