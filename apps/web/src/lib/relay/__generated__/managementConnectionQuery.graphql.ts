/**
 * @generated SignedSource<<f8c3a9e7cfa0c411976b30587626e05d>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type BankingCollectionState = "CANCELLED" | "COLLECTING" | "DESELECTED" | "DISCONNECTED" | "RECONNECT_REQUIRED" | "RETIRED" | "REVOKED" | "UNKNOWN" | "%future added value";
export type BankingReportingState = "CANCELLED" | "CURRENT" | "RETIRED" | "STAGED" | "%future added value";
export type managementConnectionQuery$variables = {
  connectionId: string;
};
export type managementConnectionQuery$data = {
  readonly bankingConnection: {
    readonly __typename: "BankingConnectionResult";
    readonly code: string;
    readonly connection: {
      readonly accounts: ReadonlyArray<{
        readonly currency: string;
        readonly id: string;
        readonly importStatus: {
          readonly collection: BankingCollectionState;
          readonly discrepancyCount: string;
          readonly reportingState: BankingReportingState;
        };
        readonly kind: string;
        readonly name: string;
        readonly providerAccountId: string;
        readonly selected: boolean;
        readonly streamId: string;
      }>;
      readonly cleanup: string;
      readonly generation: string;
      readonly health: string;
      readonly id: string;
      readonly institutionName: string | null | undefined;
      readonly permission: string;
      readonly purge: string;
      readonly state: string;
    } | null | undefined;
  };
};
export type managementConnectionQuery = {
  response: managementConnectionQuery$data;
  variables: managementConnectionQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "connectionId"
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
        "name": "connectionId",
        "variableName": "connectionId"
      }
    ],
    "concreteType": "BankingConnectionResult",
    "kind": "LinkedField",
    "name": "bankingConnection",
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
        "concreteType": "BankingConnection",
        "kind": "LinkedField",
        "name": "connection",
        "plural": false,
        "selections": [
          (v1/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "institutionName",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "permission",
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
            "name": "generation",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "health",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "cleanup",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "purge",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingAccount",
            "kind": "LinkedField",
            "name": "accounts",
            "plural": true,
            "selections": [
              (v1/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "streamId",
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
                "name": "kind",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "currency",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "selected",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "providerAccountId",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "concreteType": "BankingImportStatus",
                "kind": "LinkedField",
                "name": "importStatus",
                "plural": false,
                "selections": [
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "reportingState",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "collection",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "discrepancyCount",
                    "storageKey": null
                  }
                ],
                "storageKey": null
              }
            ],
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
    "name": "managementConnectionQuery",
    "selections": (v2/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "managementConnectionQuery",
    "selections": (v2/*:: as any*/)
  },
  "params": {
    "cacheID": "3993b5c9e28a4c651e9f710c40729d53",
    "id": null,
    "metadata": {},
    "name": "managementConnectionQuery",
    "operationKind": "query",
    "text": "query managementConnectionQuery(\n  $connectionId: ID!\n) {\n  bankingConnection(connectionId: $connectionId) {\n    __typename\n    code\n    connection {\n      id\n      institutionName\n      permission\n      state\n      generation\n      health\n      cleanup\n      purge\n      accounts {\n        id\n        streamId\n        name\n        kind\n        currency\n        selected\n        providerAccountId\n        importStatus {\n          reportingState\n          collection\n          discrepancyCount\n        }\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "55d3363cc1072bd92f411ad67daf757a";

export default node;
