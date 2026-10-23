/**
 * @generated SignedSource<<c62fdd0a1ed392b8e194108e088a8f97>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type BankingFenceInput = {
  attemptId: string;
  connectionId: string;
  expectedGeneration: string;
};
export type managementRepairStartMutation$variables = {
  input: BankingFenceInput;
};
export type managementRepairStartMutation$data = {
  readonly startBankingRepair: {
    readonly __typename: "BankingEnrollmentResult";
    readonly attemptId: string | null | undefined;
    readonly code: string;
    readonly expiresAt: string | null | undefined;
    readonly linkToken: string | null | undefined;
    readonly state: string | null | undefined;
  };
};
export type managementRepairStartMutation = {
  response: managementRepairStartMutation$data;
  variables: managementRepairStartMutation$variables;
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
    "concreteType": "BankingEnrollmentResult",
    "kind": "LinkedField",
    "name": "startBankingRepair",
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
        "name": "state",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "attemptId",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "linkToken",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "expiresAt",
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
    "name": "managementRepairStartMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "managementRepairStartMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "9aca86fb5e29f055c05a0d5a6b17307a",
    "id": null,
    "metadata": {},
    "name": "managementRepairStartMutation",
    "operationKind": "mutation",
    "text": "mutation managementRepairStartMutation(\n  $input: BankingFenceInput!\n) {\n  startBankingRepair(input: $input) {\n    __typename\n    code\n    state\n    attemptId\n    linkToken\n    expiresAt\n  }\n}\n"
  }
};
})();

(node as any).hash = "147049166a6af5cf48052a705bf4aae2";

export default node;
