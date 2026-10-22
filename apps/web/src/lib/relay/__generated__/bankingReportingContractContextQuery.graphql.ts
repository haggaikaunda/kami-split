/**
 * @generated SignedSource<<a7b1edb2f0ff39dd2e0664adb876bdb3>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type bankingReportingContractContextQuery$variables = {
  archive: string;
  attempt: string;
  source: string;
};
export type bankingReportingContractContextQuery$data = {
  readonly bankingAnnotationOperation: {
    readonly code: string;
    readonly detail: {
      readonly code: string;
      readonly currentId: string | null | undefined;
      readonly id: string;
      readonly transaction: {
        readonly current: boolean;
        readonly id: string;
        readonly sourceId: string;
      } | null | undefined;
    } | null | undefined;
    readonly id: string;
    readonly sourceId: string | null | undefined;
  };
  readonly bankingTransaction: {
    readonly code: string;
    readonly currentId: string | null | undefined;
    readonly id: string;
    readonly transaction: {
      readonly current: boolean;
      readonly id: string;
      readonly sourceId: string;
    } | null | undefined;
  };
};
export type bankingReportingContractContextQuery = {
  response: bankingReportingContractContextQuery$data;
  variables: bankingReportingContractContextQuery$variables;
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
  "kind": "ScalarField",
  "name": "code",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "sourceId",
  "storageKey": null
},
v6 = [
  (v3/*:: as any*/),
  (v4/*:: as any*/),
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
    "concreteType": "BankingTransaction",
    "kind": "LinkedField",
    "name": "transaction",
    "plural": false,
    "selections": [
      (v3/*:: as any*/),
      (v5/*:: as any*/),
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "current",
        "storageKey": null
      }
    ],
    "storageKey": null
  }
],
v7 = [
  {
    "alias": null,
    "args": [
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
    "concreteType": "BankingTransactionDetail",
    "kind": "LinkedField",
    "name": "bankingTransaction",
    "plural": false,
    "selections": (v6/*:: as any*/),
    "storageKey": null
  },
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "attemptId",
        "variableName": "attempt"
      }
    ],
    "concreteType": "BankingAnnotationResult",
    "kind": "LinkedField",
    "name": "bankingAnnotationOperation",
    "plural": false,
    "selections": [
      (v3/*:: as any*/),
      (v4/*:: as any*/),
      (v5/*:: as any*/),
      {
        "alias": null,
        "args": null,
        "concreteType": "BankingTransactionDetail",
        "kind": "LinkedField",
        "name": "detail",
        "plural": false,
        "selections": (v6/*:: as any*/),
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
      (v1/*:: as any*/),
      (v2/*:: as any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "bankingReportingContractContextQuery",
    "selections": (v7/*:: as any*/),
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
    "name": "bankingReportingContractContextQuery",
    "selections": (v7/*:: as any*/)
  },
  "params": {
    "cacheID": "3cb4a30c5009cb8a0a35722e7270207d",
    "id": null,
    "metadata": {},
    "name": "bankingReportingContractContextQuery",
    "operationKind": "query",
    "text": "query bankingReportingContractContextQuery(\n  $source: ID!\n  $archive: ID!\n  $attempt: ID!\n) {\n  bankingTransaction(sourceId: $source, archiveId: $archive) {\n    id\n    code\n    currentId\n    transaction {\n      id\n      sourceId\n      current\n    }\n  }\n  bankingAnnotationOperation(attemptId: $attempt) {\n    id\n    code\n    sourceId\n    detail {\n      id\n      code\n      currentId\n      transaction {\n        id\n        sourceId\n        current\n      }\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "bc387d9e92b456e8d3a2f1639aa6b2a4";

export default node;
