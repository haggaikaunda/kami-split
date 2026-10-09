/**
 * @generated SignedSource<<7266399214add41cd71aa842cc03e0e7>>
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
      readonly groupId: string;
      readonly id: string;
      readonly payer: {
        readonly displayName: string;
        readonly id: string;
      };
      readonly totalMinor: string;
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

(node as any).hash = "301790ed6f354830ec2262996c989f86";

export default node;
