/**
 * @generated SignedSource<<4e3a4dfce7c835b1553dafcb986ac5c5>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type BankingCollectionState = "CANCELLED" | "COLLECTING" | "DESELECTED" | "DISCONNECTED" | "RECONNECT_REQUIRED" | "RETIRED" | "REVOKED" | "UNKNOWN" | "%future added value";
export type BankingHistoricalUpdate = "COMPLETE" | "INITIAL_AVAILABLE" | "PENDING" | "UNKNOWN" | "%future added value";
export type BankingHistoryCoverage = "KNOWN_GAP" | "LIMITED" | "UNKNOWN" | "%future added value";
export type BankingImportFreshness = "OBSERVED" | "STALE" | "UNKNOWN" | "%future added value";
export type BankingImportRecovery = "CONTACT_SUPPORT" | "NONE" | "RECONNECT" | "RETRY_SCHEDULED" | "STOPPED" | "WAIT" | "%future added value";
export type BankingImportState = "FAILED" | "LOADING" | "UNAVAILABLE" | "UNKNOWN" | "USABLE" | "%future added value";
export type BankingReportingState = "CANCELLED" | "CURRENT" | "RETIRED" | "STAGED" | "%future added value";
export type BankingSyncOperation = "COMMITTED" | "HISTORY_PENDING" | "NEEDS_ATTENTION" | "QUEUED" | "RETRY_WAIT" | "RUNNING" | "STOPPED" | "UNKNOWN" | "%future added value";
export type personalInventoryQuery$variables = {
  after?: string | null | undefined;
  first: number;
};
export type personalInventoryQuery$data = {
  readonly bankingConnections: {
    readonly __typename: "BankingConnectionsResult";
    readonly code: string;
    readonly connections: ReadonlyArray<{
      readonly accounts: ReadonlyArray<{
        readonly currency: string;
        readonly id: string;
        readonly importStatus: {
          readonly collection: BankingCollectionState;
          readonly coverage: BankingHistoryCoverage;
          readonly discrepancyCount: string;
          readonly freshness: BankingImportFreshness;
          readonly historicalUpdate: BankingHistoricalUpdate;
          readonly historyAvailability: string;
          readonly importState: BankingImportState;
          readonly lastLocalCommit: string | null | undefined;
          readonly operation: BankingSyncOperation;
          readonly providerSuccessAt: string | null | undefined;
          readonly recovery: BankingImportRecovery;
          readonly reportingState: BankingReportingState;
          readonly usable: boolean;
        };
        readonly kind: string;
        readonly name: string;
        readonly requestedHistoryDays: number;
        readonly selected: boolean;
        readonly streamId: string;
      }>;
      readonly cleanup: string;
      readonly health: string;
      readonly id: string;
      readonly institutionName: string | null | undefined;
      readonly permission: string;
      readonly purge: string;
      readonly state: string;
    }>;
    readonly endCursor: string | null | undefined;
    readonly hasNextPage: boolean;
  };
};
export type personalInventoryQuery = {
  response: personalInventoryQuery$data;
  variables: personalInventoryQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "after"
},
v1 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "first"
},
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v3 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "after",
        "variableName": "after"
      },
      {
        "kind": "Variable",
        "name": "first",
        "variableName": "first"
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
          (v2/*:: as any*/),
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
              (v2/*:: as any*/),
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
                "name": "requestedHistoryDays",
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
                    "name": "operation",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "importState",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "usable",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "recovery",
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
                    "name": "reportingState",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "freshness",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "coverage",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "historyAvailability",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "historicalUpdate",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "lastLocalCommit",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "providerSuccessAt",
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
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "personalInventoryQuery",
    "selections": (v3/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [
      (v1/*:: as any*/),
      (v0/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "personalInventoryQuery",
    "selections": (v3/*:: as any*/)
  },
  "params": {
    "cacheID": "a9cfae7c2edc7cae4e9487659666df36",
    "id": null,
    "metadata": {},
    "name": "personalInventoryQuery",
    "operationKind": "query",
    "text": "query personalInventoryQuery(\n  $first: Int!\n  $after: String\n) {\n  bankingConnections(first: $first, after: $after) {\n    __typename\n    code\n    endCursor\n    hasNextPage\n    connections {\n      id\n      institutionName\n      permission\n      state\n      health\n      cleanup\n      purge\n      accounts {\n        id\n        streamId\n        name\n        kind\n        currency\n        selected\n        requestedHistoryDays\n        importStatus {\n          operation\n          importState\n          usable\n          recovery\n          collection\n          reportingState\n          freshness\n          coverage\n          historyAvailability\n          historicalUpdate\n          lastLocalCommit\n          providerSuccessAt\n          discrepancyCount\n        }\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "dd77442833f12314f565b0e0ed1df221";

export default node;
