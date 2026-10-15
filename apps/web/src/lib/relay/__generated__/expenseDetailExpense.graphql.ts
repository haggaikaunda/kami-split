/**
 * @generated SignedSource<<6c6d8c60cbb998ef72c0022a034098de>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderFragment } from 'relay-runtime';
export type Category = "ACCOMMODATION" | "ACTIVITIES" | "DINING" | "GROCERIES" | "HOME" | "OTHER" | "TRANSPORT" | "%future added value";
export type Currency = "USD" | "%future added value";
export type ExpenseEditLockReason = "FORMER_MEMBER" | "INELIGIBLE_MEMBER" | "%future added value";
export type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "%future added value";
import { FragmentRefs } from "relay-runtime";
export type expenseDetailExpense$data = {
  readonly __typename: "Expense";
  readonly allocations: ReadonlyArray<{
    readonly amountMinor: string;
    readonly participant: {
      readonly displayName: string;
      readonly id: string;
    };
    readonly percentageHundredths: number | null | undefined;
  }>;
  readonly canEdit: boolean;
  readonly category: Category;
  readonly createdAt: string;
  readonly creator: {
    readonly displayName: string;
    readonly id: string;
  };
  readonly currency: Currency;
  readonly description: string;
  readonly editLockReason: ExpenseEditLockReason | null | undefined;
  readonly effectiveDate: string;
  readonly groupId: string;
  readonly id: string;
  readonly note: string;
  readonly payer: {
    readonly displayName: string;
    readonly id: string;
  };
  readonly split: SplitMode;
  readonly totalMinor: string;
  readonly version: string;
  readonly " $fragmentType": "expenseDetailExpense";
};
export type expenseDetailExpense$key = {
  readonly " $data"?: expenseDetailExpense$data;
  readonly " $fragmentSpreads": FragmentRefs<"expenseDetailExpense">;
};

const node: ReaderFragment = (function(){
var v0 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v1 = [
  (v0/*:: as any*/),
  {
    "alias": null,
    "args": null,
    "kind": "ScalarField",
    "name": "displayName",
    "storageKey": null
  }
];
return {
  "argumentDefinitions": [],
  "kind": "Fragment",
  "metadata": null,
  "name": "expenseDetailExpense",
  "selections": [
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "__typename",
      "storageKey": null
    },
    (v0/*:: as any*/),
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "groupId",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "version",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "canEdit",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "editLockReason",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "description",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "effectiveDate",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "totalMinor",
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
      "name": "createdAt",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "concreteType": "Membership",
      "kind": "LinkedField",
      "name": "creator",
      "plural": false,
      "selections": (v1/*:: as any*/),
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "category",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "note",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "concreteType": "Membership",
      "kind": "LinkedField",
      "name": "payer",
      "plural": false,
      "selections": (v1/*:: as any*/),
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "split",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "concreteType": "Allocation",
      "kind": "LinkedField",
      "name": "allocations",
      "plural": true,
      "selections": [
        {
          "alias": null,
          "args": null,
          "concreteType": "Membership",
          "kind": "LinkedField",
          "name": "participant",
          "plural": false,
          "selections": (v1/*:: as any*/),
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
          "name": "percentageHundredths",
          "storageKey": null
        }
      ],
      "storageKey": null
    }
  ],
  "type": "Expense",
  "abstractKey": null
};
})();

(node as any).hash = "e6a85c82923276cdbc3d86f452efa140";

export default node;
