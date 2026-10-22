/**
 * @generated SignedSource<<47046548a36cd08b48ec65997de336db>>
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
export type bankingReportingContractQuery$variables = {
  after?: string | null | undefined;
  archive: string;
  filter?: BankingReportFilter | null | undefined;
  source: string;
};
export type bankingReportingContractQuery$data = {
  readonly archived: {
    readonly transaction: {
      readonly " $fragmentSpreads": FragmentRefs<"bankingReportingContractTransaction">;
    } | null | undefined;
  };
  readonly bankingReport: {
    readonly accounts: ReadonlyArray<{
      readonly accountId: string;
      readonly coverage: string;
      readonly id: string;
      readonly intervals: ReadonlyArray<{
        readonly bindingId: string;
        readonly coverage: string;
      }>;
    }>;
    readonly id: string;
    readonly rows: ReadonlyArray<{
      readonly " $fragmentSpreads": FragmentRefs<"bankingReportingContractTransaction">;
    }>;
    readonly summary: {
      readonly netMinor: string;
    } | null | undefined;
  };
  readonly canonical: {
    readonly transaction: {
      readonly " $fragmentSpreads": FragmentRefs<"bankingReportingContractTransaction">;
    } | null | undefined;
  };
  readonly correction: {
    readonly transaction: {
      readonly " $fragmentSpreads": FragmentRefs<"bankingReportingContractTransaction">;
    } | null | undefined;
  };
};
export type bankingReportingContractQuery = {
  response: bankingReportingContractQuery$data;
  variables: bankingReportingContractQuery$variables;
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
  "name": "archive"
},
v2 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "filter"
},
v3 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "source"
},
v4 = [
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
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v6 = {
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
    }
  ],
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "coverage",
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "concreteType": "BankingReportAccount",
  "kind": "LinkedField",
  "name": "accounts",
  "plural": true,
  "selections": [
    (v5/*:: as any*/),
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "accountId",
      "storageKey": null
    },
    (v7/*:: as any*/),
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
        (v7/*:: as any*/)
      ],
      "storageKey": null
    }
  ],
  "storageKey": null
},
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "note",
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "excluded",
  "storageKey": null
},
v11 = [
  (v5/*:: as any*/),
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
    "name": "sourceRevision",
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
    "name": "annotationRevision",
    "storageKey": null
  },
  (v9/*:: as any*/),
  (v10/*:: as any*/),
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
          (v9/*:: as any*/),
          (v10/*:: as any*/)
        ],
        "storageKey": null
      }
    ],
    "storageKey": null
  }
],
v12 = [
  {
    "kind": "InlineDataFragmentSpread",
    "name": "bankingReportingContractTransaction",
    "selections": (v11/*:: as any*/),
    "args": null,
    "argumentDefinitions": ([]/*:: as any*/)
  }
],
v13 = {
  "kind": "Variable",
  "name": "sourceId",
  "variableName": "source"
},
v14 = [
  (v13/*:: as any*/)
],
v15 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "BankingTransaction",
    "kind": "LinkedField",
    "name": "transaction",
    "plural": false,
    "selections": (v12/*:: as any*/),
    "storageKey": null
  }
],
v16 = [
  {
    "kind": "Literal",
    "name": "discrepancy",
    "value": true
  },
  (v13/*:: as any*/)
],
v17 = [
  {
    "kind": "Variable",
    "name": "archiveId",
    "variableName": "archive"
  },
  (v13/*:: as any*/)
],
v18 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "BankingTransaction",
    "kind": "LinkedField",
    "name": "transaction",
    "plural": false,
    "selections": (v11/*:: as any*/),
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/),
      (v2/*:: as any*/),
      (v3/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "bankingReportingContractQuery",
    "selections": [
      {
        "alias": null,
        "args": (v4/*:: as any*/),
        "concreteType": "BankingReport",
        "kind": "LinkedField",
        "name": "bankingReport",
        "plural": false,
        "selections": [
          (v5/*:: as any*/),
          (v6/*:: as any*/),
          (v8/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingTransaction",
            "kind": "LinkedField",
            "name": "rows",
            "plural": true,
            "selections": (v12/*:: as any*/),
            "storageKey": null
          }
        ],
        "storageKey": null
      },
      {
        "alias": "canonical",
        "args": (v14/*:: as any*/),
        "concreteType": "BankingTransactionDetail",
        "kind": "LinkedField",
        "name": "bankingTransaction",
        "plural": false,
        "selections": (v15/*:: as any*/),
        "storageKey": null
      },
      {
        "alias": "correction",
        "args": (v16/*:: as any*/),
        "concreteType": "BankingTransactionDetail",
        "kind": "LinkedField",
        "name": "bankingTransaction",
        "plural": false,
        "selections": (v15/*:: as any*/),
        "storageKey": null
      },
      {
        "alias": "archived",
        "args": (v17/*:: as any*/),
        "concreteType": "BankingTransactionDetail",
        "kind": "LinkedField",
        "name": "bankingTransaction",
        "plural": false,
        "selections": (v15/*:: as any*/),
        "storageKey": null
      }
    ],
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [
      (v2/*:: as any*/),
      (v0/*:: as any*/),
      (v3/*:: as any*/),
      (v1/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "bankingReportingContractQuery",
    "selections": [
      {
        "alias": null,
        "args": (v4/*:: as any*/),
        "concreteType": "BankingReport",
        "kind": "LinkedField",
        "name": "bankingReport",
        "plural": false,
        "selections": [
          (v5/*:: as any*/),
          (v6/*:: as any*/),
          (v8/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingTransaction",
            "kind": "LinkedField",
            "name": "rows",
            "plural": true,
            "selections": (v11/*:: as any*/),
            "storageKey": null
          }
        ],
        "storageKey": null
      },
      {
        "alias": "canonical",
        "args": (v14/*:: as any*/),
        "concreteType": "BankingTransactionDetail",
        "kind": "LinkedField",
        "name": "bankingTransaction",
        "plural": false,
        "selections": (v18/*:: as any*/),
        "storageKey": null
      },
      {
        "alias": "correction",
        "args": (v16/*:: as any*/),
        "concreteType": "BankingTransactionDetail",
        "kind": "LinkedField",
        "name": "bankingTransaction",
        "plural": false,
        "selections": (v18/*:: as any*/),
        "storageKey": null
      },
      {
        "alias": "archived",
        "args": (v17/*:: as any*/),
        "concreteType": "BankingTransactionDetail",
        "kind": "LinkedField",
        "name": "bankingTransaction",
        "plural": false,
        "selections": (v18/*:: as any*/),
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "99169987798516654fd4408026f40a9d",
    "id": null,
    "metadata": {},
    "name": "bankingReportingContractQuery",
    "operationKind": "query",
    "text": "query bankingReportingContractQuery(\n  $filter: BankingReportFilter\n  $after: String\n  $source: ID!\n  $archive: ID!\n) {\n  bankingReport(filter: $filter, first: 1, after: $after) {\n    id\n    summary {\n      netMinor\n    }\n    accounts {\n      id\n      accountId\n      coverage\n      intervals {\n        bindingId\n        coverage\n      }\n    }\n    rows {\n      ...bankingReportingContractTransaction\n      id\n    }\n  }\n  canonical: bankingTransaction(sourceId: $source) {\n    transaction {\n      ...bankingReportingContractTransaction\n      id\n    }\n  }\n  correction: bankingTransaction(sourceId: $source, discrepancy: true) {\n    transaction {\n      ...bankingReportingContractTransaction\n      id\n    }\n  }\n  archived: bankingTransaction(sourceId: $source, archiveId: $archive) {\n    transaction {\n      ...bankingReportingContractTransaction\n      id\n    }\n  }\n}\n\nfragment bankingReportingContractTransaction on BankingTransaction {\n  id\n  sourceId\n  sourceRevision\n  amountMinor\n  annotationRevision\n  note\n  excluded\n  current\n  archives {\n    archiveId\n    annotation {\n      revision\n      note\n      excluded\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "7636b0365f4897f7c9589942bba8fbea";

export default node;
