/**
 * @generated SignedSource<<5e76db7c98d100eb7bd0fa14addd0aaf>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type enrollmentCancelMutation$variables = {
  attemptId: string;
};
export type enrollmentCancelMutation$data = {
  readonly cancelBankingEnrollment: {
    readonly __typename: "BankingEnrollmentResult";
    readonly attemptId: string | null | undefined;
    readonly code: string;
    readonly connectionId: string | null | undefined;
    readonly state: string | null | undefined;
  };
};
export type enrollmentCancelMutation = {
  response: enrollmentCancelMutation$data;
  variables: enrollmentCancelMutation$variables;
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
    "name": "cancelBankingEnrollment",
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
    "name": "enrollmentCancelMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "enrollmentCancelMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "2ebde11d1d7a2b2a6d059f14b07cb206",
    "id": null,
    "metadata": {},
    "name": "enrollmentCancelMutation",
    "operationKind": "mutation",
    "text": "mutation enrollmentCancelMutation(\n  $attemptId: ID!\n) {\n  cancelBankingEnrollment(attemptId: $attemptId) {\n    __typename\n    code\n    state\n    attemptId\n    connectionId\n  }\n}\n"
  }
};
})();

(node as any).hash = "2b916254c09b86b00a7f0ea21d5dce17";

export default node;
