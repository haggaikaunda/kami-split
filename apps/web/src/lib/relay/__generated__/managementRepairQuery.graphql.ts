/**
 * @generated SignedSource<<2b6070c78656320da06ce49996763dde>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type managementRepairQuery$variables = {
  attemptId: string;
};
export type managementRepairQuery$data = {
  readonly bankingRepair: {
    readonly __typename: "BankingEnrollmentResult";
    readonly attemptId: string | null | undefined;
    readonly code: string;
    readonly state: string | null | undefined;
  };
};
export type managementRepairQuery = {
  response: managementRepairQuery$data;
  variables: managementRepairQuery$variables;
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
    "concreteType": "BankingEnrollmentResult",
    "kind": "LinkedField",
    "name": "bankingRepair",
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
    "name": "managementRepairQuery",
    "selections": (v1/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "managementRepairQuery",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "58b2a38380d8d6005d6cd47fb7bd6f7b",
    "id": null,
    "metadata": {},
    "name": "managementRepairQuery",
    "operationKind": "query",
    "text": "query managementRepairQuery(\n  $attemptId: ID!\n) {\n  bankingRepair(attemptId: $attemptId) {\n    __typename\n    code\n    state\n    attemptId\n  }\n}\n"
  }
};
})();

(node as any).hash = "99190b75b6626bed1d8ca7f67abed608";

export default node;
