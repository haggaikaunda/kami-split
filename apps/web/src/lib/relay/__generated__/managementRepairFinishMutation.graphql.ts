/**
 * @generated SignedSource<<19e492c08d677afd9cb9bfd6c73936de>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type FinishBankingRepairInput = {
  accountIds: ReadonlyArray<string>;
  attemptId: string;
};
export type managementRepairFinishMutation$variables = {
  input: FinishBankingRepairInput;
};
export type managementRepairFinishMutation$data = {
  readonly finishBankingRepair: {
    readonly __typename: "BankingEnrollmentResult";
    readonly attemptId: string | null | undefined;
    readonly code: string;
    readonly state: string | null | undefined;
  };
};
export type managementRepairFinishMutation = {
  response: managementRepairFinishMutation$data;
  variables: managementRepairFinishMutation$variables;
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
    "name": "finishBankingRepair",
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
    "name": "managementRepairFinishMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "managementRepairFinishMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "db0928dd033ad021057973fc4f59b137",
    "id": null,
    "metadata": {},
    "name": "managementRepairFinishMutation",
    "operationKind": "mutation",
    "text": "mutation managementRepairFinishMutation(\n  $input: FinishBankingRepairInput!\n) {\n  finishBankingRepair(input: $input) {\n    __typename\n    code\n    state\n    attemptId\n  }\n}\n"
  }
};
})();

(node as any).hash = "b7bada614c6f6db60876798582195e57";

export default node;
