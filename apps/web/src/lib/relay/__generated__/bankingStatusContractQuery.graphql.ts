/**
 * @generated SignedSource<<0baca0c4eacd9c196a9831d463b07756>>
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
export type bankingStatusContractQuery$variables = {
  connectionId: string;
};
export type bankingStatusContractQuery$data = {
  readonly bankingConnection: {
    readonly code: string;
    readonly connection: {
      readonly accounts: ReadonlyArray<{
        readonly id: string;
        readonly importStatus: {
          readonly accountGeneration: string;
          readonly attempts: number | null | undefined;
          readonly bindingGeneration: string;
          readonly collection: BankingCollectionState;
          readonly coverage: BankingHistoryCoverage;
          readonly coverageAfter: string | null | undefined;
          readonly coverageThrough: string | null | undefined;
          readonly dataRevision: string;
          readonly discrepancyCount: string;
          readonly freshness: BankingImportFreshness;
          readonly historicalUpdate: BankingHistoricalUpdate;
          readonly historicalUpdateAt: string | null | undefined;
          readonly historyAvailability: string;
          readonly importRevision: string;
          readonly importState: BankingImportState;
          readonly intervals: ReadonlyArray<{
            readonly afterDate: string | null | undefined;
            readonly bindingId: string;
            readonly throughDate: string | null | undefined;
          }>;
          readonly lastLocalCommit: string | null | undefined;
          readonly operation: BankingSyncOperation;
          readonly planRevision: string | null | undefined;
          readonly providerFailedAt: string | null | undefined;
          readonly providerSuccessAt: string | null | undefined;
          readonly providerUpdateStatus: string | null | undefined;
          readonly recovery: BankingImportRecovery;
          readonly reportingRevision: string;
          readonly reportingState: BankingReportingState;
          readonly requestedAfter: string | null | undefined;
          readonly requestedThrough: string | null | undefined;
          readonly retryAt: string | null | undefined;
          readonly usable: boolean;
        };
        readonly requestedHistoryDays: number;
        readonly selected: boolean;
        readonly streamId: string;
      }>;
      readonly cleanup: string;
      readonly deletionGeneration: string;
      readonly generation: string;
      readonly health: string;
      readonly id: string;
      readonly permission: string;
      readonly purge: string;
      readonly snapshotRevision: string;
      readonly state: string;
    } | null | undefined;
  };
};
export type bankingStatusContractQuery = {
  response: bankingStatusContractQuery$data;
  variables: bankingStatusContractQuery$variables;
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
            "name": "deletionGeneration",
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
            "kind": "ScalarField",
            "name": "snapshotRevision",
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
                    "name": "requestedAfter",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "requestedThrough",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "coverageAfter",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "coverageThrough",
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
                    "name": "providerUpdateStatus",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "historicalUpdateAt",
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
                    "name": "providerFailedAt",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "retryAt",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "attempts",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "importRevision",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "dataRevision",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "bindingGeneration",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "accountGeneration",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "reportingRevision",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "planRevision",
                    "storageKey": null
                  },
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "BankingReportingInterval",
                    "kind": "LinkedField",
                    "name": "intervals",
                    "plural": true,
                    "selections": [
                      {
                        "alias": null,
                        "args": null,
                        "kind": "ScalarField",
                        "name": "bindingId",
                        "storageKey": null
                      },
                      {
                        "alias": null,
                        "args": null,
                        "kind": "ScalarField",
                        "name": "afterDate",
                        "storageKey": null
                      },
                      {
                        "alias": null,
                        "args": null,
                        "kind": "ScalarField",
                        "name": "throughDate",
                        "storageKey": null
                      }
                    ],
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
    "name": "bankingStatusContractQuery",
    "selections": (v2/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "bankingStatusContractQuery",
    "selections": (v2/*:: as any*/)
  },
  "params": {
    "cacheID": "980616bd5d7a44762d896dd1e7358453",
    "id": null,
    "metadata": {},
    "name": "bankingStatusContractQuery",
    "operationKind": "query",
    "text": "query bankingStatusContractQuery(\n  $connectionId: ID!\n) {\n  bankingConnection(connectionId: $connectionId) {\n    code\n    connection {\n      id\n      state\n      generation\n      deletionGeneration\n      permission\n      health\n      cleanup\n      purge\n      snapshotRevision\n      accounts {\n        id\n        streamId\n        selected\n        requestedHistoryDays\n        importStatus {\n          operation\n          importState\n          usable\n          recovery\n          collection\n          reportingState\n          freshness\n          coverage\n          historyAvailability\n          requestedAfter\n          requestedThrough\n          coverageAfter\n          coverageThrough\n          historicalUpdate\n          providerUpdateStatus\n          historicalUpdateAt\n          lastLocalCommit\n          providerSuccessAt\n          providerFailedAt\n          retryAt\n          attempts\n          importRevision\n          dataRevision\n          bindingGeneration\n          accountGeneration\n          reportingRevision\n          planRevision\n          intervals {\n            bindingId\n            afterDate\n            throughDate\n          }\n          discrepancyCount\n        }\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "edc7b8acdae047c525bd17ed7f15f656";

export default node;
