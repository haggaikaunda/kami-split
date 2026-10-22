/**
 * @generated SignedSource<<233d8c00e5e19a0093cda714e0829a6d>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type BankingEnrollmentIntent = "DIFFERENT" | "EXISTING" | "%future added value";
export type StartBankingEnrollmentInput = {
  attemptId: string;
  intent: BankingEnrollmentIntent;
};
export type enrollmentStartMutation$variables = {
  input: StartBankingEnrollmentInput;
};
export type enrollmentStartMutation$data = {
  readonly startBankingEnrollment: {
    readonly __typename: "BankingEnrollmentResult";
    readonly attemptId: string | null | undefined;
    readonly code: string;
    readonly connectionId: string | null | undefined;
    readonly expiresAt: string | null | undefined;
    readonly linkToken: string | null | undefined;
    readonly state: string | null | undefined;
  };
};
export type enrollmentStartMutation = {
  response: enrollmentStartMutation$data;
  variables: enrollmentStartMutation$variables;
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
    "name": "startBankingEnrollment",
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
    "name": "enrollmentStartMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "enrollmentStartMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "24b05d2a6865a4dea2253a0c14540cb2",
    "id": null,
    "metadata": {},
    "name": "enrollmentStartMutation",
    "operationKind": "mutation",
    "text": "mutation enrollmentStartMutation(\n  $input: StartBankingEnrollmentInput!\n) {\n  startBankingEnrollment(input: $input) {\n    __typename\n    code\n    state\n    attemptId\n    connectionId\n    linkToken\n    expiresAt\n  }\n}\n"
  }
};
})();

(node as any).hash = "f043e7198182a827ac258806b0ba8a59";

export default node;
