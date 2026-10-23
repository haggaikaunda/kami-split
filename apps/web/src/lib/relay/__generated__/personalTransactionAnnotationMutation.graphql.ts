/**
 * @generated SignedSource<<e310bbcd6e58ff11625615fa705da08e>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type BankingAnnotationField = "ACTIVITY" | "CATEGORY" | "EXCLUDED" | "NOTE" | "REVIEWED" | "%future added value";
export type BankingAnnotationInput = {
  attemptId: string;
  expectedRevision: string;
  field: BankingAnnotationField;
  materialRevision: string;
  sourceId: string;
  sourceRevision: string;
  value?: string | null | undefined;
};
export type personalTransactionAnnotationMutation$variables = {
  input: BankingAnnotationInput;
};
export type personalTransactionAnnotationMutation$data = {
  readonly editBankingAnnotation: {
    readonly code: string;
    readonly detail: {
      readonly code: string;
      readonly currentId: string | null | undefined;
      readonly id: string;
      readonly transaction: {
        readonly " $fragmentSpreads": FragmentRefs<"personalTransactionDetail">;
      } | null | undefined;
    } | null | undefined;
    readonly id: string;
    readonly sourceId: string | null | undefined;
  };
};
export type personalTransactionAnnotationMutation = {
  response: personalTransactionAnnotationMutation$data;
  variables: personalTransactionAnnotationMutation$variables;
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
  "name": "id",
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
  "name": "sourceId",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "currentId",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "accountId",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "bindingId",
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "sourceRevision",
  "storageKey": null
},
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "latestSourceRevision",
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "materialRevision",
  "storageKey": null
},
v11 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "annotationRevision",
  "storageKey": null
},
v12 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "amountMinor",
  "storageKey": null
},
v13 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "currency",
  "storageKey": null
},
v14 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "bankDate",
  "storageKey": null
},
v15 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "authorizationDate",
  "storageKey": null
},
v16 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "processingState",
  "storageKey": null
},
v17 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "providerPrimaryCategory",
  "storageKey": null
},
v18 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "providerCategory",
  "storageKey": null
},
v19 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "providerConfidence",
  "storageKey": null
},
v20 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "providerCode",
  "storageKey": null
},
v21 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "mappingVersion",
  "storageKey": null
},
v22 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "name",
  "storageKey": null
},
v23 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "merchantName",
  "storageKey": null
},
v24 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "categoryOverride",
  "storageKey": null
},
v25 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "activityOverride",
  "storageKey": null
},
v26 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "note",
  "storageKey": null
},
v27 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "excluded",
  "storageKey": null
},
v28 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "reviewed",
  "storageKey": null
},
v29 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "materialConflict",
  "storageKey": null
},
v30 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "current",
  "storageKey": null
},
v31 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "discrepancy",
  "storageKey": null
},
v32 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "category",
  "storageKey": null
},
v33 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "activity",
  "storageKey": null
},
v34 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "eligible",
  "storageKey": null
},
v35 = {
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
    (v8/*:: as any*/),
    (v11/*:: as any*/),
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
        (v10/*:: as any*/),
        (v32/*:: as any*/),
        (v33/*:: as any*/),
        (v26/*:: as any*/),
        (v27/*:: as any*/),
        (v28/*:: as any*/)
      ],
      "storageKey": null
    }
  ],
  "storageKey": null
};
return {
  "fragment": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "personalTransactionAnnotationMutation",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": "BankingAnnotationResult",
        "kind": "LinkedField",
        "name": "editBankingAnnotation",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          (v3/*:: as any*/),
          (v4/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingTransactionDetail",
            "kind": "LinkedField",
            "name": "detail",
            "plural": false,
            "selections": [
              (v2/*:: as any*/),
              (v3/*:: as any*/),
              (v5/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "BankingTransaction",
                "kind": "LinkedField",
                "name": "transaction",
                "plural": false,
                "selections": [
                  {
                    "kind": "InlineDataFragmentSpread",
                    "name": "personalTransactionDetail",
                    "selections": [
                      (v4/*:: as any*/),
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
                      (v18/*:: as any*/),
                      (v19/*:: as any*/),
                      (v20/*:: as any*/),
                      (v21/*:: as any*/),
                      (v22/*:: as any*/),
                      (v23/*:: as any*/),
                      (v24/*:: as any*/),
                      (v25/*:: as any*/),
                      (v26/*:: as any*/),
                      (v27/*:: as any*/),
                      (v28/*:: as any*/),
                      (v29/*:: as any*/),
                      (v30/*:: as any*/),
                      (v5/*:: as any*/),
                      (v31/*:: as any*/),
                      (v32/*:: as any*/),
                      (v33/*:: as any*/),
                      (v34/*:: as any*/),
                      (v35/*:: as any*/)
                    ],
                    "args": null,
                    "argumentDefinitions": []
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
    "type": "Mutation",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*:: as any*/),
    "kind": "Operation",
    "name": "personalTransactionAnnotationMutation",
    "selections": [
      {
        "alias": null,
        "args": (v1/*:: as any*/),
        "concreteType": "BankingAnnotationResult",
        "kind": "LinkedField",
        "name": "editBankingAnnotation",
        "plural": false,
        "selections": [
          (v2/*:: as any*/),
          (v3/*:: as any*/),
          (v4/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingTransactionDetail",
            "kind": "LinkedField",
            "name": "detail",
            "plural": false,
            "selections": [
              (v2/*:: as any*/),
              (v3/*:: as any*/),
              (v5/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "BankingTransaction",
                "kind": "LinkedField",
                "name": "transaction",
                "plural": false,
                "selections": [
                  (v4/*:: as any*/),
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
                  (v18/*:: as any*/),
                  (v19/*:: as any*/),
                  (v20/*:: as any*/),
                  (v21/*:: as any*/),
                  (v22/*:: as any*/),
                  (v23/*:: as any*/),
                  (v24/*:: as any*/),
                  (v25/*:: as any*/),
                  (v26/*:: as any*/),
                  (v27/*:: as any*/),
                  (v28/*:: as any*/),
                  (v29/*:: as any*/),
                  (v30/*:: as any*/),
                  (v5/*:: as any*/),
                  (v31/*:: as any*/),
                  (v32/*:: as any*/),
                  (v33/*:: as any*/),
                  (v34/*:: as any*/),
                  (v35/*:: as any*/),
                  (v2/*:: as any*/)
                ],
                "storageKey": null
              }
            ],
            "storageKey": null
          }
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "f19aab98d851606ee610a5d031d7fb86",
    "id": null,
    "metadata": {},
    "name": "personalTransactionAnnotationMutation",
    "operationKind": "mutation",
    "text": "mutation personalTransactionAnnotationMutation(\n  $input: BankingAnnotationInput!\n) {\n  editBankingAnnotation(input: $input) {\n    id\n    code\n    sourceId\n    detail {\n      id\n      code\n      currentId\n      transaction {\n        ...personalTransactionDetail\n        id\n      }\n    }\n  }\n}\n\nfragment personalTransactionDetail on BankingTransaction {\n  sourceId\n  accountId\n  bindingId\n  sourceRevision\n  latestSourceRevision\n  materialRevision\n  annotationRevision\n  amountMinor\n  currency\n  bankDate\n  authorizationDate\n  processingState\n  providerPrimaryCategory\n  providerCategory\n  providerConfidence\n  providerCode\n  mappingVersion\n  name\n  merchantName\n  categoryOverride\n  activityOverride\n  note\n  excluded\n  reviewed\n  materialConflict\n  current\n  currentId\n  discrepancy\n  category\n  activity\n  eligible\n  archives {\n    archiveId\n    sourceRevision\n    annotationRevision\n    annotation {\n      revision\n      materialRevision\n      category\n      activity\n      note\n      excluded\n      reviewed\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "3164cbe55bab656d60638328a9d015bf";

export default node;
