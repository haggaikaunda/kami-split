/**
 * @generated SignedSource<<1a6821701b5cba7878eac69974f7709b>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type managementCurrentQuery$variables = {
  sourceId: string;
};
export type managementCurrentQuery$data = {
  readonly bankingTransaction: {
    readonly __typename: "BankingTransactionDetail";
    readonly code: string;
    readonly currentId: string | null | undefined;
    readonly id: string;
    readonly transaction: {
      readonly amountMinor: string;
      readonly annotationRevision: string;
      readonly bankDate: string;
      readonly id: string;
      readonly name: string | null | undefined;
      readonly note: string | null | undefined;
      readonly sourceId: string;
      readonly sourceRevision: string;
    } | null | undefined;
  };
};
export type managementCurrentQuery = {
  response: managementCurrentQuery$data;
  variables: managementCurrentQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "sourceId"
  }
],
v1 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v2 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "sourceId",
        "variableName": "sourceId"
      }
    ],
    "concreteType": "BankingTransactionDetail",
    "kind": "LinkedField",
    "name": "bankingTransaction",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "__typename",
        "storageKey": null
      },
      (v1/*:: as any*/),
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
        "name": "currentId",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": "BankingTransaction",
        "kind": "LinkedField",
        "name": "transaction",
        "plural": false,
        "selections": [
          (v1/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "sourceId",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "bankDate",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "amountMinor",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "name",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "note",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "annotationRevision",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "sourceRevision",
            "storageKey": null
          }
        ],
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
    "name": "managementCurrentQuery",
    "selections": (v2/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "managementCurrentQuery",
    "selections": (v2/*:: as any*/)
  },
  "params": {
    "cacheID": "6cdd45d27f9d1f4b7bc2a236142f5a9f",
    "id": null,
    "metadata": {},
    "name": "managementCurrentQuery",
    "operationKind": "query",
    "text": "query managementCurrentQuery(\n  $sourceId: ID!\n) {\n  bankingTransaction(sourceId: $sourceId) {\n    __typename\n    id\n    code\n    currentId\n    transaction {\n      id\n      sourceId\n      bankDate\n      amountMinor\n      name\n      note\n      annotationRevision\n      sourceRevision\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "8aefe259561968051a64daa481882906";

export default node;
