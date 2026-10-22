/**
 * @generated SignedSource<<9297a1b6571dd2a527073fadc0f405be>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type FinishBankingEnrollmentInput = {
  accountIds: ReadonlyArray<string>;
  attemptId: string;
  publicToken: string;
};
export type enrollmentFinishMutation$variables = {
  input: FinishBankingEnrollmentInput;
};
export type enrollmentFinishMutation$data = {
  readonly finishBankingEnrollment: {
    readonly __typename: "BankingEnrollmentResult";
    readonly attemptId: string | null | undefined;
    readonly code: string;
    readonly connectionId: string | null | undefined;
    readonly state: string | null | undefined;
  };
};
export type enrollmentFinishMutation = {
  response: enrollmentFinishMutation$data;
  variables: enrollmentFinishMutation$variables;
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
    "name": "finishBankingEnrollment",
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
    "name": "enrollmentFinishMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "enrollmentFinishMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "667dccaf1e994f8a3e4d2d574fa1cddc",
    "id": null,
    "metadata": {},
    "name": "enrollmentFinishMutation",
    "operationKind": "mutation",
    "text": "mutation enrollmentFinishMutation(\n  $input: FinishBankingEnrollmentInput!\n) {\n  finishBankingEnrollment(input: $input) {\n    __typename\n    code\n    state\n    attemptId\n    connectionId\n  }\n}\n"
  }
};
})();

(node as any).hash = "e17da9be81533c6e0ac85ae63083ce7a";

export default node;
