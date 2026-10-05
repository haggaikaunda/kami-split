/**
 * @generated SignedSource<<e8a6c32dbb4f530bb70cbff9711c2857>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderInlineDataFragment } from 'relay-runtime';
export type ActivityKind = "EXPENSE_CREATED" | "REPAYMENT_RECORDED" | "%future added value";
export type Currency = "USD" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
import { FragmentRefs } from "relay-runtime";
export type activityFeed$data = {
  readonly __typename: "ActivityConnection";
  readonly edges: ReadonlyArray<{
    readonly cursor: string;
    readonly node: {
      readonly amountMinor: string;
      readonly creator: {
        readonly displayName: string;
        readonly id: string;
      };
      readonly currency: Currency;
      readonly effectiveDate: string;
      readonly groupId: string;
      readonly groupName: string;
      readonly id: string;
      readonly isHousehold: boolean;
      readonly kind: ActivityKind;
      readonly payer: {
        readonly displayName: string;
        readonly id: string;
      } | null | undefined;
      readonly recipient: {
        readonly displayName: string;
        readonly id: string;
      } | null | undefined;
      readonly recordId: string;
      readonly sender: {
        readonly displayName: string;
        readonly id: string;
      } | null | undefined;
      readonly timestamp: string;
    };
  }>;
  readonly pageInfo: {
    readonly endCursor: string | null | undefined;
    readonly hasNextPage: boolean;
  };
  readonly " $fragmentType": "activityFeed";
} | {
  readonly __typename: "Problem";
  readonly code: ProblemCode;
  readonly message: string;
  readonly " $fragmentType": "activityFeed";
} | {
  // This will never be '%other', but we need some
  // value in case none of the concrete values match.
  readonly __typename: "%other";
  readonly " $fragmentType": "activityFeed";
};
export type activityFeed$key = {
  readonly " $data"?: activityFeed$data;
  readonly " $fragmentSpreads": FragmentRefs<"activityFeed">;
};

const node: ReaderInlineDataFragment = {
  "kind": "InlineDataFragment",
  "name": "activityFeed"
};

(node as any).hash = "cb7d4450082d44825b3a6f09a990082f";

export default node;
