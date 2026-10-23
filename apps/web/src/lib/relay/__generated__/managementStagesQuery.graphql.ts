/**
 * @generated SignedSource<<d9f0bfc2c4f8b11915eeeb8c7510c5db>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type BankingReportingState = "CANCELLED" | "CURRENT" | "RETIRED" | "STAGED" | "%future added value";
export type managementStagesQuery$variables = {
  after?: string | null | undefined;
};
export type managementStagesQuery$data = {
  readonly bankingConnections: {
    readonly __typename: "BankingConnectionsResult";
    readonly code: string;
    readonly connections: ReadonlyArray<{
      readonly accounts: ReadonlyArray<{
        readonly id: string;
        readonly importStatus: {
          readonly reportingState: BankingReportingState;
        };
        readonly name: string;
        readonly streamId: string;
      }>;
      readonly id: string;
    }>;
    readonly endCursor: string | null | undefined;
    readonly hasNextPage: boolean;
  };
};
export type managementStagesQuery = {
  response: managementStagesQuery$data;
  variables: managementStagesQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "after"
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
        "name": "after",
        "variableName": "after"
      },
      {
        "kind": "Literal",
        "name": "first",
        "value": 50
      }
    ],
    "concreteType": "BankingConnectionsResult",
    "kind": "LinkedField",
    "name": "bankingConnections",
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
        "name": "endCursor",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "hasNextPage",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": "BankingConnection",
        "kind": "LinkedField",
        "name": "connections",
        "plural": true,
        "selections": [
          (v1/*:: as any*/),
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
    "name": "managementStagesQuery",
    "selections": (v2/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "managementStagesQuery",
    "selections": (v2/*:: as any*/)
  },
  "params": {
    "cacheID": "20b2eda27e6d36ad1c7b9be8bdf84bcd",
    "id": null,
    "metadata": {},
    "name": "managementStagesQuery",
    "operationKind": "query",
    "text": "query managementStagesQuery(\n  $after: String\n) {\n  bankingConnections(first: 50, after: $after) {\n    __typename\n    code\n    endCursor\n    hasNextPage\n    connections {\n      id\n      accounts {\n        id\n        streamId\n        name\n        importStatus {\n          reportingState\n        }\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "a9d91eb45cad2e475676ece3ee7ac285";

export default node;
