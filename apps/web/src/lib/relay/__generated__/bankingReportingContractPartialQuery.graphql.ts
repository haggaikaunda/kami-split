/**
 * @generated SignedSource<<256ad352c48a9700cada1ef9ec0c73f6>>
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
export type bankingReportingContractPartialQuery$variables = {
  after?: string | null | undefined;
  filter?: BankingReportFilter | null | undefined;
};
export type bankingReportingContractPartialQuery$data = {
  readonly bankingReport: {
    readonly rows: ReadonlyArray<{
      readonly id: string;
      readonly note: string | null | undefined;
      readonly sourceId: string;
    }>;
  };
};
export type bankingReportingContractPartialQuery = {
  response: bankingReportingContractPartialQuery$data;
  variables: bankingReportingContractPartialQuery$variables;
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
  "name": "filter"
},
v2 = [
  {
    "kind": "Variable",
    "name": "after",
    "variableName": "after"
  },
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
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "concreteType": "BankingTransaction",
  "kind": "LinkedField",
  "name": "rows",
  "plural": true,
  "selections": [
    (v3/*:: as any*/),
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
      "name": "note",
      "storageKey": null
    }
  ],
  "storageKey": null
};
return {
  "fragment": {
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "bankingReportingContractPartialQuery",
    "selections": [
      {
        "alias": null,
        "args": (v2/*:: as any*/),
        "concreteType": "BankingReport",
        "kind": "LinkedField",
        "name": "bankingReport",
        "plural": false,
        "selections": [
          (v4/*:: as any*/)
        ],
        "storageKey": null
      }
    ],
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
    "name": "bankingReportingContractPartialQuery",
    "selections": [
      {
        "alias": null,
        "args": (v2/*:: as any*/),
        "concreteType": "BankingReport",
        "kind": "LinkedField",
        "name": "bankingReport",
        "plural": false,
        "selections": [
          (v4/*:: as any*/),
          (v3/*:: as any*/)
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "867edd8522bff7f0ef26d1dcea80fb6f",
    "id": null,
    "metadata": {},
    "name": "bankingReportingContractPartialQuery",
    "operationKind": "query",
    "text": "query bankingReportingContractPartialQuery(\n  $filter: BankingReportFilter\n  $after: String\n) {\n  bankingReport(filter: $filter, first: 1, after: $after) {\n    rows {\n      id\n      sourceId\n      note\n    }\n    id\n  }\n}\n"
  }
};
})();

(node as any).hash = "799e90e2e44ca5a9f3d16f3e07847eb1";

export default node;
