/**
 * @generated SignedSource<<5a26f36e7af171bb06505b5db3ebb962>>
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
export type managementDisconnectMutation$variables = {
  input: BankingFenceInput;
};
export type managementDisconnectMutation$data = {
  readonly disconnectBanking: {
    readonly __typename: "BankingManagementResult";
    readonly code: string;
  };
};
export type managementDisconnectMutation = {
  response: managementDisconnectMutation$data;
  variables: managementDisconnectMutation$variables;
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
    "name": "disconnectBanking",
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
    "name": "managementDisconnectMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "managementDisconnectMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "eb4fffd57247cb50f0d7fe13b19da49a",
    "id": null,
    "metadata": {},
    "name": "managementDisconnectMutation",
    "operationKind": "mutation",
    "text": "mutation managementDisconnectMutation(\n  $input: BankingFenceInput!\n) {\n  disconnectBanking(input: $input) {\n    __typename\n    code\n  }\n}\n"
  }
};
})();

(node as any).hash = "c346954e16d7ebe45cd30e3bf69b1833";

export default node;
