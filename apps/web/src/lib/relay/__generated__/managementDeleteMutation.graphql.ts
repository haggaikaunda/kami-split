/**
 * @generated SignedSource<<43f97a841ec1a47611edd0339d3909b4>>
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
export type managementDeleteMutation$variables = {
  input: BankingFenceInput;
};
export type managementDeleteMutation$data = {
  readonly deleteBankingHistory: {
    readonly __typename: "BankingManagementResult";
    readonly code: string;
  };
};
export type managementDeleteMutation = {
  response: managementDeleteMutation$data;
  variables: managementDeleteMutation$variables;
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
    "concreteType": "BankingManagementResult",
    "kind": "LinkedField",
    "name": "deleteBankingHistory",
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
    "name": "managementDeleteMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "managementDeleteMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "9a7cd6fb1074ac1fedf780114c7f2484",
    "id": null,
    "metadata": {},
    "name": "managementDeleteMutation",
    "operationKind": "mutation",
    "text": "mutation managementDeleteMutation(\n  $input: BankingFenceInput!\n) {\n  deleteBankingHistory(input: $input) {\n    __typename\n    code\n  }\n}\n"
  }
};
})();

(node as any).hash = "0564a71307c99a817b53c778bbbe74c3";

export default node;
