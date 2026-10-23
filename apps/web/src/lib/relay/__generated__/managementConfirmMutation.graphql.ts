/**
 * @generated SignedSource<<8c4d36ea5929e7fcadbf54c9ed1af9ba>>
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
export type managementConfirmMutation$variables = {
  input: ConfirmBankingReplacementInput;
};
export type managementConfirmMutation$data = {
  readonly confirmBankingReplacement: {
    readonly __typename: "BankingReplacementResult";
    readonly code: string;
    readonly resultId: string | null | undefined;
  };
};
export type managementConfirmMutation = {
  response: managementConfirmMutation$data;
  variables: managementConfirmMutation$variables;
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
    "name": "confirmBankingReplacement",
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
    "name": "managementConfirmMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "managementConfirmMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "cb9399d8033e3ac188d7bdffacb51604",
    "id": null,
    "metadata": {},
    "name": "managementConfirmMutation",
    "operationKind": "mutation",
    "text": "mutation managementConfirmMutation(\n  $input: ConfirmBankingReplacementInput!\n) {\n  confirmBankingReplacement(input: $input) {\n    __typename\n    code\n    resultId\n  }\n}\n"
  }
};
})();

(node as any).hash = "b18302d9b0763a6ff92bfa7273657213";

export default node;
