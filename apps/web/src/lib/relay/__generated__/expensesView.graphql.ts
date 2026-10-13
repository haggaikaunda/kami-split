/**
 * @generated SignedSource<<11b4e38fefa99ef7270fa21aeeb4f946>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderInlineDataFragment } from 'relay-runtime';
export type Category = "ACCOMMODATION" | "ACTIVITIES" | "DINING" | "GROCERIES" | "HOME" | "OTHER" | "TRANSPORT" | "%future added value";
export type Currency = "USD" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
import { FragmentRefs } from "relay-runtime";
export type expensesView$data = {
  readonly __typename: "ExpenseView";
  readonly categories: ReadonlyArray<{
    readonly category: Category;
    readonly expenseCount: string;
    readonly totalExpenseMinor: string;
    readonly viewerShareMinor: string;
  }>;
  readonly contextVersion: string;
  readonly edges: ReadonlyArray<{
    readonly cursor: string;
    readonly node: {
      readonly allocations: ReadonlyArray<{
        readonly amountMinor: string;
        readonly participant: {
          readonly id: string;
        };
      }>;
      readonly category: Category;
      readonly description: string;
      readonly effectiveDate: string;
      readonly expenseId: string;
      readonly groupId: string;
      readonly payer: {
        readonly displayName: string;
        readonly id: string;
      };
      readonly totalMinor: string;
      readonly version: string;
    };
    readonly source: {
      readonly currency: Currency;
      readonly name: string;
    };
  }>;
  readonly expenseCount: string;
  readonly months: ReadonlyArray<{
    readonly expenseCount: string;
    readonly month: string;
    readonly totalExpenseMinor: string;
  }>;
  readonly pageInfo: {
    readonly endCursor: string | null | undefined;
    readonly hasNextPage: boolean;
  };
  readonly totalExpenseMinor: string;
  readonly viewerPaidMinor: string;
  readonly viewerShareMinor: string;
  readonly " $fragmentType": "expensesView";
} | {
  readonly __typename: "Problem";
  readonly code: ProblemCode;
  readonly " $fragmentType": "expensesView";
} | {
  // This will never be '%other', but we need some
  // value in case none of the concrete values match.
  readonly __typename: "%other";
  readonly " $fragmentType": "expensesView";
};
export type expensesView$key = {
  readonly " $data"?: expensesView$data;
  readonly " $fragmentSpreads": FragmentRefs<"expensesView">;
};

const node: ReaderInlineDataFragment = {
  "kind": "InlineDataFragment",
  "name": "expensesView"
};

(node as any).hash = "fc39f72bf72ffcadb266dd47a1a3f4a0";

export default node;
