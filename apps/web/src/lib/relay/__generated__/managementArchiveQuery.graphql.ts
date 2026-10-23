/**
 * @generated SignedSource<<ccee594ae4f32a58264d8e0d80d5628a>>
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
export type managementArchiveQuery$variables = {
  after?: string | null | undefined;
  filter: BankingReportFilter;
};
export type managementArchiveQuery$data = {
  readonly bankingReport: {
    readonly __typename: "BankingReport";
    readonly code: string;
    readonly endCursor: string | null | undefined;
    readonly hasNextPage: boolean;
    readonly id: string;
    readonly rows: ReadonlyArray<{
      readonly amountMinor: string;
      readonly annotationRevision: string;
      readonly archives: ReadonlyArray<{
        readonly annotation: {
          readonly excluded: boolean;
          readonly note: string | null | undefined;
          readonly revision: string;
        } | null | undefined;
        readonly annotationRevision: string | null | undefined;
        readonly archiveId: string;
        readonly sourceRevision: string;
      }>;
      readonly bankDate: string;
      readonly currency: string;
      readonly current: boolean;
      readonly currentId: string | null | undefined;
      readonly discrepancy: string;
      readonly excluded: boolean;
      readonly id: string;
      readonly latestSourceRevision: string;
      readonly name: string | null | undefined;
      readonly note: string | null | undefined;
      readonly sourceId: string;
      readonly sourceRevision: string;
    }>;
    readonly totalCount: number;
  };
};
export type managementArchiveQuery = {
  response: managementArchiveQuery$data;
  variables: managementArchiveQuery$variables;
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
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "sourceRevision",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "annotationRevision",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "note",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "excluded",
  "storageKey": null
},
v7 = [
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
        "name": "filter",
        "variableName": "filter"
      },
      {
        "kind": "Literal",
        "name": "first",
        "value": 20
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
      (v2/*:: as any*/),
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
        "name": "totalCount",
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
        "kind": "ScalarField",
        "name": "endCursor",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": "BankingTransaction",
        "kind": "LinkedField",
        "name": "rows",
        "plural": true,
        "selections": [
          (v2/*:: as any*/),
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
            "name": "currentId",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "current",
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
            "name": "currency",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "name",
            "storageKey": null
          },
          (v3/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "latestSourceRevision",
            "storageKey": null
          },
          (v4/*:: as any*/),
          (v5/*:: as any*/),
          (v6/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "discrepancy",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingArchiveReference",
            "kind": "LinkedField",
            "name": "archives",
            "plural": true,
            "selections": [
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "archiveId",
                "storageKey": null
              },
              (v3/*:: as any*/),
              (v4/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "BankingAnnotationSnapshot",
                "kind": "LinkedField",
                "name": "annotation",
                "plural": false,
                "selections": [
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "revision",
                    "storageKey": null
                  },
                  (v5/*:: as any*/),
                  (v6/*:: as any*/)
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
    "name": "managementArchiveQuery",
    "selections": (v7/*:: as any*/),
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
    "name": "managementArchiveQuery",
    "selections": (v7/*:: as any*/)
  },
  "params": {
    "cacheID": "bf56bafd0f58b1624e8c8f0523d941ee",
    "id": null,
    "metadata": {},
    "name": "managementArchiveQuery",
    "operationKind": "query",
    "text": "query managementArchiveQuery(\n  $filter: BankingReportFilter!\n  $after: String\n) {\n  bankingReport(filter: $filter, first: 20, after: $after) {\n    __typename\n    id\n    code\n    totalCount\n    hasNextPage\n    endCursor\n    rows {\n      id\n      sourceId\n      currentId\n      current\n      bankDate\n      amountMinor\n      currency\n      name\n      sourceRevision\n      latestSourceRevision\n      annotationRevision\n      note\n      excluded\n      discrepancy\n      archives {\n        archiveId\n        sourceRevision\n        annotationRevision\n        annotation {\n          revision\n          note\n          excluded\n        }\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "0d09d11d682ba6bad79aef6a5ec8d2e9";

export default node;
