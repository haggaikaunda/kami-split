/**
 * @generated SignedSource<<699cf9dadf2f6bebd42f4a807b484f9d>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type enrollmentRecoveryQuery$variables = {
  attemptId: string;
};
export type enrollmentRecoveryQuery$data = {
  readonly bankingEnrollment: {
    readonly __typename: "BankingEnrollmentResult";
    readonly attemptId: string | null | undefined;
    readonly code: string;
    readonly connectionId: string | null | undefined;
    readonly state: string | null | undefined;
  };
};
export type enrollmentRecoveryQuery = {
  response: enrollmentRecoveryQuery$data;
  variables: enrollmentRecoveryQuery$variables;
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
    "name": "bankingEnrollment",
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
    "name": "enrollmentRecoveryQuery",
    "selections": (v1/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "enrollmentRecoveryQuery",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "90fe43d5e3836643d9cb33f29bacbc85",
    "id": null,
    "metadata": {},
    "name": "enrollmentRecoveryQuery",
    "operationKind": "query",
    "text": "query enrollmentRecoveryQuery(\n  $attemptId: ID!\n) {\n  bankingEnrollment(attemptId: $attemptId) {\n    __typename\n    code\n    state\n    attemptId\n    connectionId\n  }\n}\n"
  }
};
})();

(node as any).hash = "96bc0c203f18e5f5357c521c0b65b96b";

export default node;
