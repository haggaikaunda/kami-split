/**
 * @generated SignedSource<<da8e47d1b1b907108ae5a41702892d12>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type bankingReportingContractContextPartialQuery$variables = {
  archive: string;
  attempt: string;
  source: string;
};
export type bankingReportingContractContextPartialQuery$data = {
  readonly bankingAnnotationOperation: {
    readonly detail: {
      readonly code: string;
    } | null | undefined;
  };
  readonly bankingTransaction: {
    readonly transaction: {
      readonly current: boolean;
      readonly id: string;
      readonly sourceId: string;
    } | null | undefined;
  };
};
export type bankingReportingContractContextPartialQuery = {
  response: bankingReportingContractContextPartialQuery$data;
  variables: bankingReportingContractContextPartialQuery$variables;
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
  "name": "attempt"
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
    "name": "sourceId",
    "variableName": "source"
  }
],
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
  "concreteType": "BankingTransaction",
  "kind": "LinkedField",
  "name": "transaction",
  "plural": false,
  "selections": [
    (v4/*:: as any*/),
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
      "name": "current",
      "storageKey": null
    }
  ],
  "storageKey": null
},
v6 = [
  {
    "kind": "Variable",
    "name": "attemptId",
    "variableName": "attempt"
  }
],
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "code",
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
    "name": "bankingReportingContractContextPartialQuery",
    "selections": [
      {
        "alias": null,
        "args": (v3/*:: as any*/),
        "concreteType": "BankingTransactionDetail",
        "kind": "LinkedField",
        "name": "bankingTransaction",
        "plural": false,
        "selections": [
          (v5/*:: as any*/)
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": (v6/*:: as any*/),
        "concreteType": "BankingAnnotationResult",
        "kind": "LinkedField",
        "name": "bankingAnnotationOperation",
        "plural": false,
        "selections": [
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingTransactionDetail",
            "kind": "LinkedField",
            "name": "detail",
            "plural": false,
            "selections": [
              (v7/*:: as any*/)
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
    "name": "bankingReportingContractContextPartialQuery",
    "selections": [
      {
        "alias": null,
        "args": (v3/*:: as any*/),
        "concreteType": "BankingTransactionDetail",
        "kind": "LinkedField",
        "name": "bankingTransaction",
        "plural": false,
        "selections": [
          (v5/*:: as any*/),
          (v4/*:: as any*/)
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": (v6/*:: as any*/),
        "concreteType": "BankingAnnotationResult",
        "kind": "LinkedField",
        "name": "bankingAnnotationOperation",
        "plural": false,
        "selections": [
          {
            "alias": null,
            "args": null,
            "concreteType": "BankingTransactionDetail",
            "kind": "LinkedField",
            "name": "detail",
            "plural": false,
            "selections": [
              (v7/*:: as any*/),
              (v4/*:: as any*/)
            ],
            "storageKey": null
          },
          (v4/*:: as any*/)
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "0ff0b0095cdefd302cdda3d2b2838bb2",
    "id": null,
    "metadata": {},
    "name": "bankingReportingContractContextPartialQuery",
    "operationKind": "query",
    "text": "query bankingReportingContractContextPartialQuery(\n  $source: ID!\n  $archive: ID!\n  $attempt: ID!\n) {\n  bankingTransaction(sourceId: $source, archiveId: $archive) {\n    transaction {\n      id\n      sourceId\n      current\n    }\n    id\n  }\n  bankingAnnotationOperation(attemptId: $attempt) {\n    detail {\n      code\n      id\n    }\n    id\n  }\n}\n"
  }
};
})();

(node as any).hash = "0b71a28c126afcfa6706285584958c6a";

export default node;
