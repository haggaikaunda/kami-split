/**
 * @generated SignedSource<<294eb9e311748c1a7a70dc0c51bdb4cd>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type BankingReplacementAction = "ACTIVATE" | "CHANGE_BOUNDARY" | "RESTORE_PREDECESSOR" | "%future added value";
export type BankingReplacementRequest = {
  accountId: string;
  action: BankingReplacementAction;
  bindingId?: string | null | undefined;
  transitionDate?: string | null | undefined;
};
export type managementPreviewQuery$variables = {
  input: BankingReplacementRequest;
};
export type managementPreviewQuery$data = {
  readonly bankingReplacementPreview: {
    readonly __typename: "BankingReplacementPreview";
    readonly archived: {
      readonly " $fragmentSpreads": FragmentRefs<"managementImpact">;
    } | null | undefined;
    readonly code: string;
    readonly collectionState: string | null | undefined;
    readonly coverage: string | null | undefined;
    readonly coverageAfter: string | null | undefined;
    readonly coverageThrough: string | null | undefined;
    readonly discrepancyCount: number | null | undefined;
    readonly intervals: ReadonlyArray<{
      readonly afterDate: string | null | undefined;
      readonly bindingId: string;
      readonly throughDate: string | null | undefined;
    }> | null | undefined;
    readonly new: {
      readonly " $fragmentSpreads": FragmentRefs<"managementImpact">;
    } | null | undefined;
    readonly oldAfterBoundary: {
      readonly " $fragmentSpreads": FragmentRefs<"managementImpact">;
    } | null | undefined;
    readonly overlap: {
      readonly " $fragmentSpreads": FragmentRefs<"managementImpact">;
    } | null | undefined;
    readonly prior: {
      readonly " $fragmentSpreads": FragmentRefs<"managementImpact">;
    } | null | undefined;
    readonly proposed: {
      readonly " $fragmentSpreads": FragmentRefs<"managementImpact">;
    } | null | undefined;
    readonly reportingRevision: string | null | undefined;
    readonly retained: {
      readonly " $fragmentSpreads": FragmentRefs<"managementImpact">;
    } | null | undefined;
    readonly revisions: {
      readonly annotation: string;
      readonly data: string;
      readonly import: string;
      readonly lifecycle: string;
      readonly plan: string;
    } | null | undefined;
  };
};
export type managementPreviewQuery = {
  response: managementPreviewQuery$data;
  variables: managementPreviewQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "input"
  }
],
v1 = [
  {
    "kind": "Variable",
    "name": "input",
    "variableName": "input"
  }
],
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "__typename",
  "storageKey": null
},
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "code",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "reportingRevision",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "coverage",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "coverageAfter",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "coverageThrough",
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "discrepancyCount",
  "storageKey": null
},
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "collectionState",
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "concreteType": "BankingReplacementRevisions",
  "kind": "LinkedField",
  "name": "revisions",
  "plural": false,
  "selections": [
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "plan",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "import",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "data",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "annotation",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "lifecycle",
      "storageKey": null
    }
  ],
  "storageKey": null
},
v11 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "throughDate",
  "storageKey": null
},
v12 = {
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
    (v11/*:: as any*/)
  ],
  "storageKey": null
},
v13 = [
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "count",
    "storageKey": null
  },
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "fromDate",
    "storageKey": null
  },
  (v11/*:: as any*/),
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "spendingMinor",
    "storageKey": null
  },
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "annotationCount",
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
    "name": "unresolvedCount",
    "storageKey": null
  }
],
v14 = [
  {
    "kind": "InlineDataFragmentSpread",
    "name": "managementImpact",
    "selections": (v13/*:: as any*/),
    "args": null,
    "argumentDefinitions": ([]/*:: as any*/)
  }
];
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "managementPreviewQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": "BankingReplacementPreview",
        "kind": "LinkedField",
        "name": "bankingReplacementPreview",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          (v3/*:: as any*/),
          (v4/*:: as any*/),
          (v5/*:: as any*/),
          (v6/*:: as any*/),
          (v7/*:: as any*/),
          (v8/*:: as any*/),
          (v9/*:: as any*/),
          (v10/*:: as any*/),
          (v12/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingReplacementImpact",
            "kind": "LinkedField",
            "name": "prior",
            "plural": false,
            "selections": (v14/*:: as any*/),
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingReplacementImpact",
            "kind": "LinkedField",
            "name": "proposed",
            "plural": false,
            "selections": (v14/*:: as any*/),
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingReplacementImpact",
            "kind": "LinkedField",
            "name": "retained",
            "plural": false,
            "selections": (v14/*:: as any*/),
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingReplacementImpact",
            "kind": "LinkedField",
            "name": "new",
            "plural": false,
            "selections": (v14/*:: as any*/),
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingReplacementImpact",
            "kind": "LinkedField",
            "name": "archived",
            "plural": false,
            "selections": (v14/*:: as any*/),
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingReplacementImpact",
            "kind": "LinkedField",
            "name": "overlap",
            "plural": false,
            "selections": (v14/*:: as any*/),
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingReplacementImpact",
            "kind": "LinkedField",
            "name": "oldAfterBoundary",
            "plural": false,
            "selections": (v14/*:: as any*/),
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
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "managementPreviewQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": "BankingReplacementPreview",
        "kind": "LinkedField",
        "name": "bankingReplacementPreview",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          (v3/*:: as any*/),
          (v4/*:: as any*/),
          (v5/*:: as any*/),
          (v6/*:: as any*/),
          (v7/*:: as any*/),
          (v8/*:: as any*/),
          (v9/*:: as any*/),
          (v10/*:: as any*/),
          (v12/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingReplacementImpact",
            "kind": "LinkedField",
            "name": "prior",
            "plural": false,
            "selections": (v13/*:: as any*/),
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingReplacementImpact",
            "kind": "LinkedField",
            "name": "proposed",
            "plural": false,
            "selections": (v13/*:: as any*/),
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingReplacementImpact",
            "kind": "LinkedField",
            "name": "retained",
            "plural": false,
            "selections": (v13/*:: as any*/),
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingReplacementImpact",
            "kind": "LinkedField",
            "name": "new",
            "plural": false,
            "selections": (v13/*:: as any*/),
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingReplacementImpact",
            "kind": "LinkedField",
            "name": "archived",
            "plural": false,
            "selections": (v13/*:: as any*/),
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingReplacementImpact",
            "kind": "LinkedField",
            "name": "overlap",
            "plural": false,
            "selections": (v13/*:: as any*/),
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingReplacementImpact",
            "kind": "LinkedField",
            "name": "oldAfterBoundary",
            "plural": false,
            "selections": (v13/*:: as any*/),
            "storageKey": null
          }
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "65af1658f56845461468bb3cae980de0",
    "id": null,
    "metadata": {},
    "name": "managementPreviewQuery",
    "operationKind": "query",
    "text": "query managementPreviewQuery(\n  $input: BankingReplacementRequest!\n) {\n  bankingReplacementPreview(input: $input) {\n    __typename\n    code\n    reportingRevision\n    coverage\n    coverageAfter\n    coverageThrough\n    discrepancyCount\n    collectionState\n    revisions {\n      plan\n      import\n      data\n      annotation\n      lifecycle\n    }\n    intervals {\n      bindingId\n      afterDate\n      throughDate\n    }\n    prior {\n      ...managementImpact\n    }\n    proposed {\n      ...managementImpact\n    }\n    retained {\n      ...managementImpact\n    }\n    new {\n      ...managementImpact\n    }\n    archived {\n      ...managementImpact\n    }\n    overlap {\n      ...managementImpact\n    }\n    oldAfterBoundary {\n      ...managementImpact\n    }\n  }\n}\n\nfragment managementImpact on BankingReplacementImpact {\n  count\n  fromDate\n  throughDate\n  spendingMinor\n  annotationCount\n  pendingCount\n  unresolvedCount\n}\n"
  }
};
})();

(node as any).hash = "710c7a50f356a36698fd2d38e852f106";

export default node;
