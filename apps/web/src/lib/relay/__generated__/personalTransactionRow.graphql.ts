/**
 * @generated SignedSource<<56271dcc343b872101826606ff7f37e7>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderFragment } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type personalTransactionRow$data = {
  readonly accountId: string;
  readonly activity: string;
  readonly amountMinor: string;
  readonly archives: ReadonlyArray<{
    readonly annotation: {
      readonly excluded: boolean;
      readonly note: string | null | undefined;
      readonly reviewed: boolean;
      readonly revision: string;
    } | null | undefined;
    readonly annotationRevision: string | null | undefined;
    readonly archiveId: string;
    readonly sourceRevision: string;
  }>;
  readonly bankDate: string;
  readonly bindingId: string;
  readonly category: string;
  readonly currency: string;
  readonly current: boolean;
  readonly currentId: string | null | undefined;
  readonly discrepancy: string;
  readonly excluded: boolean;
  readonly latestSourceRevision: string;
  readonly materialConflict: boolean;
  readonly merchantName: string | null | undefined;
  readonly name: string | null | undefined;
  readonly processingState: string;
  readonly reviewed: boolean;
  readonly sourceId: string;
  readonly sourceRevision: string;
  readonly " $fragmentType": "personalTransactionRow";
};
export type personalTransactionRow$key = {
  readonly " $data"?: personalTransactionRow$data;
  readonly " $fragmentSpreads": FragmentRefs<"personalTransactionRow">;
};

const node: ReaderFragment = (function(){
var v0 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "sourceRevision",
  "storageKey": null
},
v1 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "excluded",
  "storageKey": null
},
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "reviewed",
  "storageKey": null
};
return {
  "argumentDefinitions": [],
  "kind": "Fragment",
  "metadata": null,
  "name": "personalTransactionRow",
  "selections": [
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
      "name": "accountId",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "bindingId",
      "storageKey": null
    },
    (v0/*:: as any*/),
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
    (v1/*:: as any*/),
    (v2/*:: as any*/),
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
        (v0/*:: as any*/),
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
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "revision",
              "storageKey": null
            },
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "note",
              "storageKey": null
            },
            (v1/*:: as any*/),
            (v2/*:: as any*/)
          ],
          "storageKey": null
        }
      ],
      "storageKey": null
    }
  ],
  "type": "BankingTransaction",
  "abstractKey": null
};
})();

(node as any).hash = "2a071f2892615d123d2b3d329f762c76";

export default node;
