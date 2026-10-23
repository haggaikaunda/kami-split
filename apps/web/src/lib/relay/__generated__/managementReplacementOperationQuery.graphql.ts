/**
 * @generated SignedSource<<39ac07e0254630c6a15e7ad8fa622d9c>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type managementReplacementOperationQuery$variables = {
  attemptId: string;
};
export type managementReplacementOperationQuery$data = {
  readonly bankingReplacementOperation: {
    readonly __typename: "BankingReplacementResult";
    readonly code: string;
    readonly resultId: string | null | undefined;
  };
};
export type managementReplacementOperationQuery = {
  response: managementReplacementOperationQuery$data;
  variables: managementReplacementOperationQuery$variables;
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
    "concreteType": "BankingReplacementResult",
    "kind": "LinkedField",
    "name": "bankingReplacementOperation",
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
    "name": "managementReplacementOperationQuery",
    "selections": (v1/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "managementReplacementOperationQuery",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "947e567e2b809d2762c94a6734b9f550",
    "id": null,
    "metadata": {},
    "name": "managementReplacementOperationQuery",
    "operationKind": "query",
    "text": "query managementReplacementOperationQuery(\n  $attemptId: ID!\n) {\n  bankingReplacementOperation(attemptId: $attemptId) {\n    __typename\n    code\n    resultId\n  }\n}\n"
  }
};
})();

(node as any).hash = "e5a3f33cccf3f1943ac83122b7e3cb2a";

export default node;
