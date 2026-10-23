/**
 * @generated SignedSource<<da28ace3daaf7a6c6b9b292a30390045>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type StartBankingReplacementInput = {
  accountId: string;
  attemptId: string;
};
export type managementReplacementStartMutation$variables = {
  input: StartBankingReplacementInput;
};
export type managementReplacementStartMutation$data = {
  readonly startBankingReplacement: {
    readonly __typename: "BankingEnrollmentResult";
    readonly attemptId: string | null | undefined;
    readonly code: string;
    readonly connectionId: string | null | undefined;
    readonly expiresAt: string | null | undefined;
    readonly linkToken: string | null | undefined;
    readonly state: string | null | undefined;
  };
};
export type managementReplacementStartMutation = {
  response: managementReplacementStartMutation$data;
  variables: managementReplacementStartMutation$variables;
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
    "name": "startBankingReplacement",
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
        "name": "connectionId",
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
    "name": "managementReplacementStartMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "managementReplacementStartMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "9606faed0e3cd94eee3deec4227694d7",
    "id": null,
    "metadata": {},
    "name": "managementReplacementStartMutation",
    "operationKind": "mutation",
    "text": "mutation managementReplacementStartMutation(\n  $input: StartBankingReplacementInput!\n) {\n  startBankingReplacement(input: $input) {\n    __typename\n    code\n    state\n    attemptId\n    connectionId\n    linkToken\n    expiresAt\n  }\n}\n"
  }
};
})();

(node as any).hash = "b1d0f1b9800fb57c8f97b74a94f135d9";

export default node;
