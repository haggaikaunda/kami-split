/**
 * @generated SignedSource<<f51db8812555f81abe36511d003fe1a8>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type managementOperationQuery$variables = {
  attemptId: string;
};
export type managementOperationQuery$data = {
  readonly bankingOperation: {
    readonly __typename: "BankingManagementResult";
    readonly code: string;
  };
};
export type managementOperationQuery = {
  response: managementOperationQuery$data;
  variables: managementOperationQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "attemptId"
  }
],
v1 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "attemptId",
        "variableName": "attemptId"
      }
    ],
    "concreteType": "BankingManagementResult",
    "kind": "LinkedField",
    "name": "bankingOperation",
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
    "name": "managementOperationQuery",
    "selections": (v1/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "managementOperationQuery",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "1bdcd0047158048ef6ce1ba34084d62b",
    "id": null,
    "metadata": {},
    "name": "managementOperationQuery",
    "operationKind": "query",
    "text": "query managementOperationQuery(\n  $attemptId: ID!\n) {\n  bankingOperation(attemptId: $attemptId) {\n    __typename\n    code\n  }\n}\n"
  }
};
})();

(node as any).hash = "5c787e85ba8f126ac4d54f50db542651";

export default node;
