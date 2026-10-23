/**
 * @generated SignedSource<<b297d7be466eddc0b6599ae68f333ab6>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type BankingSelectionInput = {
  accountIds: ReadonlyArray<string>;
  attemptId: string;
  connectionId: string;
  expectedGeneration: string;
};
export type managementSelectionMutation$variables = {
  input: BankingSelectionInput;
};
export type managementSelectionMutation$data = {
  readonly changeBankingSelection: {
    readonly __typename: "BankingManagementResult";
    readonly code: string;
  };
};
export type managementSelectionMutation = {
  response: managementSelectionMutation$data;
  variables: managementSelectionMutation$variables;
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
    "name": "changeBankingSelection",
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
    "name": "managementSelectionMutation",
    "selections": (v1/*:: as any*/),
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "managementSelectionMutation",
    "selections": (v1/*:: as any*/)
  },
  "params": {
    "cacheID": "3a656e94ecd7f366c2ce52300c54b20d",
    "id": null,
    "metadata": {},
    "name": "managementSelectionMutation",
    "operationKind": "mutation",
    "text": "mutation managementSelectionMutation(\n  $input: BankingSelectionInput!\n) {\n  changeBankingSelection(input: $input) {\n    __typename\n    code\n  }\n}\n"
  }
};
})();

(node as any).hash = "63f74ee0210fef591a2e80ae4029b4ab";

export default node;
