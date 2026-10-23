/**
 * @generated SignedSource<<a05a210f5339884a6384dc6ec90945f0>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
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
export type personalTransactionsQuery$variables = {
  after?: string | null | undefined;
  filter?: BankingReportFilter | null | undefined;
};
export type personalTransactionsQuery$data = {
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
      readonly coverage: string;
      readonly id: string;
      readonly intervals: ReadonlyArray<{
        readonly afterDate: string | null | undefined;
        readonly bindingId: string;
        readonly collectionState: string;
        readonly collectionStopped: boolean;
        readonly coverage: string;
        readonly coverageAfter: string | null | undefined;
        readonly coverageThrough: string | null | undefined;
        readonly discrepancyCount: number;
        readonly importState: string;
        readonly lastLocalCommit: string | null | undefined;
        readonly providerSuccessAt: string | null | undefined;
        readonly throughDate: string | null | undefined;
      }>;
      readonly kind: string;
      readonly planId: string | null | undefined;
      readonly selected: boolean;
      readonly transitionDate: string | null | undefined;
    }>;
    readonly activityChoices: ReadonlyArray<string>;
    readonly asOfDate: string;
    readonly categoryChoices: ReadonlyArray<string>;
    readonly code: string;
    readonly counts: {
      readonly classificationComplete: boolean;
      readonly count: number;
      readonly excludedCount: number;
      readonly pendingCount: number;
      readonly postedCount: number;
      readonly removedCount: number;
      readonly reviewedCount: number;
      readonly unresolvedCount: number;
    } | null | undefined;
    readonly end: string;
    readonly endCursor: string | null | undefined;
    readonly fieldErrors: ReadonlyArray<string>;
    readonly hasNextPage: boolean;
    readonly id: string;
    readonly revision: string;
    readonly rows: ReadonlyArray<{
      readonly sourceId: string;
      readonly " $fragmentSpreads": FragmentRefs<"personalTransactionRow">;
    }>;
    readonly spendingContext: string;
    readonly start: string;
    readonly summary: {
      readonly classificationComplete: boolean;
      readonly netMinor: string;
      readonly purchaseMinor: string;
      readonly refundMinor: string;
    } | null | undefined;
    readonly timezone: string;
    readonly totalCount: number;
  };
};
export type personalTransactionsQuery = {
  response: personalTransactionsQuery$data;
  variables: personalTransactionsQuery$variables;
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
    "value": 50
  }
],
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "__typename",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "code",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "fieldErrors",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "start",
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "end",
  "storageKey": null
},
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "asOfDate",
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "timezone",
  "storageKey": null
},
v11 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "revision",
  "storageKey": null
},
v12 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "totalCount",
  "storageKey": null
},
v13 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "spendingContext",
  "storageKey": null
},
v14 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "endCursor",
  "storageKey": null
},
v15 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "hasNextPage",
  "storageKey": null
},
v16 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "activityChoices",
  "storageKey": null
},
v17 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "categoryChoices",
  "storageKey": null
},
v18 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "count",
  "storageKey": null
},
v19 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "classificationComplete",
  "storageKey": null
},
v20 = {
  "alias": null,
  "args": null,
  "concreteType": "BankingReportCounts",
  "kind": "LinkedField",
  "name": "counts",
  "plural": false,
  "selections": [
    (v18/*:: as any*/),
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "postedCount",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "pendingCount",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "removedCount",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "excludedCount",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "unresolvedCount",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "reviewedCount",
      "storageKey": null
    },
    (v19/*:: as any*/)
  ],
  "storageKey": null
},
v21 = {
  "alias": null,
  "args": null,
  "concreteType": "BankingReportSummary",
  "kind": "LinkedField",
  "name": "summary",
  "plural": false,
  "selections": [
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "netMinor",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "purchaseMinor",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "refundMinor",
      "storageKey": null
    },
    (v19/*:: as any*/)
  ],
  "storageKey": null
},
v22 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "accountId",
  "storageKey": null
},
v23 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "coverage",
  "storageKey": null
},
v24 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "planId",
  "storageKey": null
},
v25 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "bindingId",
  "storageKey": null
},
v26 = {
  "alias": null,
  "args": null,
  "concreteType": "BankingReportAccount",
  "kind": "LinkedField",
  "name": "accounts",
  "plural": true,
  "selections": [
    (v4/*:: as any*/),
    (v22/*:: as any*/),
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
      "name": "selected",
      "storageKey": null
    },
    (v23/*:: as any*/),
    (v24/*:: as any*/),
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
      "concreteType": "BankingReportArchive",
      "kind": "LinkedField",
      "name": "archives",
      "plural": true,
      "selections": [
        (v4/*:: as any*/),
        (v24/*:: as any*/),
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "boundaryDate",
          "storageKey": null
        },
        (v18/*:: as any*/)
      ],
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
        (v25/*:: as any*/),
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
        },
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "importState",
          "storageKey": null
        },
        (v23/*:: as any*/),
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
          "name": "collectionState",
          "storageKey": null
        },
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "collectionStopped",
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
},
v27 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "sourceId",
  "storageKey": null
},
v28 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "sourceRevision",
  "storageKey": null
},
v29 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "excluded",
  "storageKey": null
},
v30 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "reviewed",
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
    "name": "personalTransactionsQuery",
    "selections": [
      {
        "alias": null,
        "args": (v2/*:: as any*/),
        "concreteType": "BankingReport",
        "kind": "LinkedField",
        "name": "bankingReport",
        "plural": false,
        "selections": [
          (v3/*:: as any*/),
          (v4/*:: as any*/),
          (v5/*:: as any*/),
          (v6/*:: as any*/),
          (v7/*:: as any*/),
          (v8/*:: as any*/),
          (v9/*:: as any*/),
          (v10/*:: as any*/),
          (v11/*:: as any*/),
          (v12/*:: as any*/),
          (v13/*:: as any*/),
          (v14/*:: as any*/),
          (v15/*:: as any*/),
          (v16/*:: as any*/),
          (v17/*:: as any*/),
          (v20/*:: as any*/),
          (v21/*:: as any*/),
          (v26/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingTransaction",
            "kind": "LinkedField",
            "name": "rows",
            "plural": true,
            "selections": [
              (v27/*:: as any*/),
              {
                "args": null,
                "kind": "FragmentSpread",
                "name": "personalTransactionRow"
              }
            ],
            "storageKey": null
          }
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
    "name": "personalTransactionsQuery",
    "selections": [
      {
        "alias": null,
        "args": (v2/*:: as any*/),
        "concreteType": "BankingReport",
        "kind": "LinkedField",
        "name": "bankingReport",
        "plural": false,
        "selections": [
          (v3/*:: as any*/),
          (v4/*:: as any*/),
          (v5/*:: as any*/),
          (v6/*:: as any*/),
          (v7/*:: as any*/),
          (v8/*:: as any*/),
          (v9/*:: as any*/),
          (v10/*:: as any*/),
          (v11/*:: as any*/),
          (v12/*:: as any*/),
          (v13/*:: as any*/),
          (v14/*:: as any*/),
          (v15/*:: as any*/),
          (v16/*:: as any*/),
          (v17/*:: as any*/),
          (v20/*:: as any*/),
          (v21/*:: as any*/),
          (v26/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingTransaction",
            "kind": "LinkedField",
            "name": "rows",
            "plural": true,
            "selections": [
              (v27/*:: as any*/),
              (v22/*:: as any*/),
              (v25/*:: as any*/),
              (v28/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "latestSourceRevision",
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
                "name": "merchantName",
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
                "name": "processingState",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "activity",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "category",
                "storageKey": null
              },
              (v29/*:: as any*/),
              (v30/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "materialConflict",
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
                "name": "currentId",
                "storageKey": null
              },
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
                  (v28/*:: as any*/),
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
                    "concreteType": "BankingAnnotationSnapshot",
                    "kind": "LinkedField",
                    "name": "annotation",
                    "plural": false,
                    "selections": [
                      (v11/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "kind": "ScalarField",
                        "name": "note",
                        "storageKey": null
                      },
                      (v29/*:: as any*/),
                      (v30/*:: as any*/)
                    ],
                    "storageKey": null
                  }
                ],
                "storageKey": null
              },
              (v4/*:: as any*/)
            ],
            "storageKey": null
          }
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "13de8f51c0d05c591f67467ec1c18ddc",
    "id": null,
    "metadata": {},
    "name": "personalTransactionsQuery",
    "operationKind": "query",
    "text": "query personalTransactionsQuery(\n  $filter: BankingReportFilter\n  $after: String\n) {\n  bankingReport(filter: $filter, first: 50, after: $after) {\n    __typename\n    id\n    code\n    fieldErrors\n    start\n    end\n    asOfDate\n    timezone\n    revision\n    totalCount\n    spendingContext\n    endCursor\n    hasNextPage\n    activityChoices\n    categoryChoices\n    counts {\n      count\n      postedCount\n      pendingCount\n      removedCount\n      excludedCount\n      unresolvedCount\n      reviewedCount\n      classificationComplete\n    }\n    summary {\n      netMinor\n      purchaseMinor\n      refundMinor\n      classificationComplete\n    }\n    accounts {\n      id\n      accountId\n      kind\n      selected\n      coverage\n      planId\n      transitionDate\n      archives {\n        id\n        planId\n        boundaryDate\n        count\n      }\n      intervals {\n        bindingId\n        afterDate\n        throughDate\n        importState\n        coverage\n        coverageAfter\n        coverageThrough\n        collectionState\n        collectionStopped\n        lastLocalCommit\n        providerSuccessAt\n        discrepancyCount\n      }\n    }\n    rows {\n      sourceId\n      ...personalTransactionRow\n      id\n    }\n  }\n}\n\nfragment personalTransactionRow on BankingTransaction {\n  sourceId\n  accountId\n  bindingId\n  sourceRevision\n  latestSourceRevision\n  bankDate\n  amountMinor\n  currency\n  merchantName\n  name\n  processingState\n  activity\n  category\n  excluded\n  reviewed\n  materialConflict\n  current\n  currentId\n  discrepancy\n  archives {\n    archiveId\n    sourceRevision\n    annotationRevision\n    annotation {\n      revision\n      note\n      excluded\n      reviewed\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "f1824b0f373953eb70c2f58aa29cf468";

export default node;
