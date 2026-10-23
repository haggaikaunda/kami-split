/**
 * @generated SignedSource<<d58b0e9165920b6df3d7c2923756761e>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type BankingPeriod = "CUSTOM" | "LAST_60_DAYS" | "LAST_90_DAYS" | "LAST_MONTH" | "THIS_MONTH" | "YEAR_TO_DATE" | "%future added value";
export type BankingReportFilter = {
  accountIds?: ReadonlyArray<string> | null | undefined;
  activities?: ReadonlyArray<string> | null | undefined;
  archiveId?: string | null | undefined;
  categories?: ReadonlyArray<string> | null | undefined;
  end?: string | null | undefined;
  excluded?: boolean | null | undefined;
  period?: BankingPeriod | null | undefined;
  reviewed?: boolean | null | undefined;
  sourceDiscrepancies?: boolean | null | undefined;
  start?: string | null | undefined;
  states?: ReadonlyArray<string> | null | undefined;
};
export type managementRecoveryQuery$variables = {
  filter: BankingReportFilter;
};
export type managementRecoveryQuery$data = {
  readonly bankingReport: {
    readonly __typename: "BankingReport";
    readonly accounts: ReadonlyArray<{
      readonly accountId: string;
      readonly archives: ReadonlyArray<{
        readonly boundaryDate: string;
        readonly count: number;
        readonly id: string;
        readonly planId: string;
      }>;
      readonly id: string;
      readonly intervals: ReadonlyArray<{
        readonly afterDate: string | null | undefined;
        readonly bindingId: string;
        readonly throughDate: string | null | undefined;
      }>;
      readonly planId: string | null | undefined;
      readonly predecessorId: string | null | undefined;
      readonly transitionDate: string | null | undefined;
    }>;
    readonly asOfDate: string;
    readonly code: string;
    readonly id: string;
  };
};
export type managementRecoveryQuery = {
  response: managementRecoveryQuery$data;
  variables: managementRecoveryQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "filter"
  }
],
v1 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "planId",
  "storageKey": null
},
v3 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "filter",
        "variableName": "filter"
      },
      {
        "kind": "Literal",
        "name": "first",
        "value": 1
      }
    ],
    "concreteType": "BankingReport",
    "kind": "LinkedField",
    "name": "bankingReport",
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
        "name": "asOfDate",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": "BankingReportAccount",
        "kind": "LinkedField",
        "name": "accounts",
        "plural": true,
        "selections": [
          (v1/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "accountId",
            "storageKey": null
          },
          (v2/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "predecessorId",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "transitionDate",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingReportInterval",
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
            "concreteType": "BankingReportArchive",
            "kind": "LinkedField",
            "name": "archives",
            "plural": true,
            "selections": [
              (v1/*:: as any*/),
              (v2/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "boundaryDate",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "count",
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
    "name": "managementRecoveryQuery",
    "selections": (v3/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "managementRecoveryQuery",
    "selections": (v3/*:: as any*/)
  },
  "params": {
    "cacheID": "9cc4a6ef30fa1d0d00d40d2f1944687e",
    "id": null,
    "metadata": {},
    "name": "managementRecoveryQuery",
    "operationKind": "query",
    "text": "query managementRecoveryQuery(\n  $filter: BankingReportFilter!\n) {\n  bankingReport(filter: $filter, first: 1) {\n    __typename\n    id\n    code\n    asOfDate\n    accounts {\n      id\n      accountId\n      planId\n      predecessorId\n      transitionDate\n      intervals {\n        bindingId\n        afterDate\n        throughDate\n      }\n      archives {\n        id\n        planId\n        boundaryDate\n        count\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "28ba5b83148b8f98d608ee27af232c8d";

export default node;
