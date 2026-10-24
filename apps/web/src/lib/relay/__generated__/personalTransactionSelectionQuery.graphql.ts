/**
 * @generated SignedSource<<db92e21a4ecb71f662afd202662c8974>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type personalTransactionSelectionQuery$variables = {
  archive?: string | null | undefined;
  discrepancy?: boolean | null | undefined;
  source: string;
};
export type personalTransactionSelectionQuery$data = {
  readonly bankingTransaction: {
    readonly __typename: "BankingTransactionDetail";
    readonly code: string;
    readonly currentId: string | null | undefined;
    readonly id: string;
    readonly transaction: {
      readonly " $fragmentSpreads": FragmentRefs<"personalTransactionDetail" | "personalTransactionRow">;
    } | null | undefined;
  };
};
export type personalTransactionSelectionQuery = {
  response: personalTransactionSelectionQuery$data;
  variables: personalTransactionSelectionQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "archive"
},
v1 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "discrepancy"
},
v2 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "source"
},
v3 = [
  {
    "kind": "Variable",
    "name": "archiveId",
    "variableName": "archive"
  },
  {
    "kind": "Variable",
    "name": "discrepancy",
    "variableName": "discrepancy"
  },
  {
    "kind": "Variable",
    "name": "sourceId",
    "variableName": "source"
  }
],
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "__typename",
  "storageKey": null
},
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
  "kind": "ScalarField",
  "name": "code",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "currentId",
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "sourceId",
  "storageKey": null
},
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "accountId",
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "bindingId",
  "storageKey": null
},
v11 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "sourceRevision",
  "storageKey": null
},
v12 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "latestSourceRevision",
  "storageKey": null
},
v13 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "materialRevision",
  "storageKey": null
},
v14 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "annotationRevision",
  "storageKey": null
},
v15 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "amountMinor",
  "storageKey": null
},
v16 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "currency",
  "storageKey": null
},
v17 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "bankDate",
  "storageKey": null
},
v18 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "authorizationDate",
  "storageKey": null
},
v19 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "processingState",
  "storageKey": null
},
v20 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "providerPrimaryCategory",
  "storageKey": null
},
v21 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "providerCategory",
  "storageKey": null
},
v22 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "providerConfidence",
  "storageKey": null
},
v23 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "providerCode",
  "storageKey": null
},
v24 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "mappingVersion",
  "storageKey": null
},
v25 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "name",
  "storageKey": null
},
v26 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "merchantName",
  "storageKey": null
},
v27 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "categoryOverride",
  "storageKey": null
},
v28 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "activityOverride",
  "storageKey": null
},
v29 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "note",
  "storageKey": null
},
v30 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "excluded",
  "storageKey": null
},
v31 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "reviewed",
  "storageKey": null
},
v32 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "materialConflict",
  "storageKey": null
},
v33 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "current",
  "storageKey": null
},
v34 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "discrepancy",
  "storageKey": null
},
v35 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "category",
  "storageKey": null
},
v36 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "activity",
  "storageKey": null
},
v37 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "eligible",
  "storageKey": null
},
v38 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "archiveId",
  "storageKey": null
},
v39 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "revision",
  "storageKey": null
};
return {
  "fragment": {
    "argumentDefinitions": [
      (v0/*:: as any*/),
      (v1/*:: as any*/),
      (v2/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "personalTransactionSelectionQuery",
    "selections": [
      {
        "alias": null,
        "args": (v3/*:: as any*/),
        "concreteType": "BankingTransactionDetail",
        "kind": "LinkedField",
        "name": "bankingTransaction",
        "plural": false,
        "selections": [
          (v4/*:: as any*/),
          (v5/*:: as any*/),
          (v6/*:: as any*/),
          (v7/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingTransaction",
            "kind": "LinkedField",
            "name": "transaction",
            "plural": false,
            "selections": [
              {
                "args": null,
                "kind": "FragmentSpread",
                "name": "personalTransactionRow"
              },
              {
                "kind": "InlineDataFragmentSpread",
                "name": "personalTransactionDetail",
                "selections": [
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
                  (v31/*:: as any*/),
                  (v32/*:: as any*/),
                  (v33/*:: as any*/),
                  (v7/*:: as any*/),
                  (v34/*:: as any*/),
                  (v35/*:: as any*/),
                  (v36/*:: as any*/),
                  (v37/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "BankingArchiveReference",
                    "kind": "LinkedField",
                    "name": "archives",
                    "plural": true,
                    "selections": [
                      (v38/*:: as any*/),
                      (v11/*:: as any*/),
                      (v14/*:: as any*/),
                      {
                        "alias": null,
                        "args": null,
                        "concreteType": "BankingAnnotationSnapshot",
                        "kind": "LinkedField",
                        "name": "annotation",
                        "plural": false,
                        "selections": [
                          (v39/*:: as any*/),
                          (v13/*:: as any*/),
                          (v35/*:: as any*/),
                          (v36/*:: as any*/),
                          (v29/*:: as any*/),
                          (v30/*:: as any*/),
                          (v31/*:: as any*/)
                        ],
                        "storageKey": null
                      }
                    ],
                    "storageKey": null
                  }
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
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [
      (v2/*:: as any*/),
      (v0/*:: as any*/),
      (v1/*:: as any*/)
    ],
    "kind": "Operation",
    "name": "personalTransactionSelectionQuery",
    "selections": [
      {
        "alias": null,
        "args": (v3/*:: as any*/),
        "concreteType": "BankingTransactionDetail",
        "kind": "LinkedField",
        "name": "bankingTransaction",
        "plural": false,
        "selections": [
          (v4/*:: as any*/),
          (v5/*:: as any*/),
          (v6/*:: as any*/),
          (v7/*:: as any*/),
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingTransaction",
            "kind": "LinkedField",
            "name": "transaction",
            "plural": false,
            "selections": [
              (v8/*:: as any*/),
              (v9/*:: as any*/),
              (v10/*:: as any*/),
              (v11/*:: as any*/),
              (v12/*:: as any*/),
              (v17/*:: as any*/),
              (v15/*:: as any*/),
              (v16/*:: as any*/),
              (v26/*:: as any*/),
              (v25/*:: as any*/),
              (v19/*:: as any*/),
              (v36/*:: as any*/),
              (v35/*:: as any*/),
              (v30/*:: as any*/),
              (v31/*:: as any*/),
              (v32/*:: as any*/),
              (v33/*:: as any*/),
              (v7/*:: as any*/),
              (v34/*:: as any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "BankingArchiveReference",
                "kind": "LinkedField",
                "name": "archives",
                "plural": true,
                "selections": [
                  (v38/*:: as any*/),
                  (v11/*:: as any*/),
                  (v14/*:: as any*/),
                  {
                    "alias": null,
                    "args": null,
                    "concreteType": "BankingAnnotationSnapshot",
                    "kind": "LinkedField",
                    "name": "annotation",
                    "plural": false,
                    "selections": [
                      (v39/*:: as any*/),
                      (v29/*:: as any*/),
                      (v30/*:: as any*/),
                      (v31/*:: as any*/),
                      (v13/*:: as any*/),
                      (v35/*:: as any*/),
                      (v36/*:: as any*/)
                    ],
                    "storageKey": null
                  }
                ],
                "storageKey": null
              },
              (v13/*:: as any*/),
              (v14/*:: as any*/),
              (v18/*:: as any*/),
              (v20/*:: as any*/),
              (v21/*:: as any*/),
              (v22/*:: as any*/),
              (v23/*:: as any*/),
              (v24/*:: as any*/),
              (v27/*:: as any*/),
              (v28/*:: as any*/),
              (v29/*:: as any*/),
              (v37/*:: as any*/),
              (v5/*:: as any*/)
            ],
            "storageKey": null
          }
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "3cb01c0c06ab04d3b57242593cf3bbfb",
    "id": null,
    "metadata": {},
    "name": "personalTransactionSelectionQuery",
    "operationKind": "query",
    "text": "query personalTransactionSelectionQuery(\n  $source: ID!\n  $archive: ID\n  $discrepancy: Boolean\n) {\n  bankingTransaction(sourceId: $source, archiveId: $archive, discrepancy: $discrepancy) {\n    __typename\n    id\n    code\n    currentId\n    transaction {\n      ...personalTransactionRow\n      ...personalTransactionDetail\n      id\n    }\n  }\n}\n\nfragment personalTransactionDetail on BankingTransaction {\n  sourceId\n  accountId\n  bindingId\n  sourceRevision\n  latestSourceRevision\n  materialRevision\n  annotationRevision\n  amountMinor\n  currency\n  bankDate\n  authorizationDate\n  processingState\n  providerPrimaryCategory\n  providerCategory\n  providerConfidence\n  providerCode\n  mappingVersion\n  name\n  merchantName\n  categoryOverride\n  activityOverride\n  note\n  excluded\n  reviewed\n  materialConflict\n  current\n  currentId\n  discrepancy\n  category\n  activity\n  eligible\n  archives {\n    archiveId\n    sourceRevision\n    annotationRevision\n    annotation {\n      revision\n      materialRevision\n      category\n      activity\n      note\n      excluded\n      reviewed\n    }\n  }\n}\n\nfragment personalTransactionRow on BankingTransaction {\n  sourceId\n  accountId\n  bindingId\n  sourceRevision\n  latestSourceRevision\n  bankDate\n  amountMinor\n  currency\n  merchantName\n  name\n  processingState\n  activity\n  category\n  excluded\n  reviewed\n  materialConflict\n  current\n  currentId\n  discrepancy\n  archives {\n    archiveId\n    sourceRevision\n    annotationRevision\n    annotation {\n      revision\n      note\n      excluded\n      reviewed\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "cd36270e3c66599516125355999bfb1e";

export default node;
