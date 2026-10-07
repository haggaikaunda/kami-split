/**
 * @generated SignedSource<<c4e1aabf90070eedc4fb9bbbe63b62bc>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderInlineDataFragment } from 'relay-runtime';
export type ActivityKind = "EXPENSE_CREATED" | "EXPENSE_UPDATED" | "REPAYMENT_RECORDED" | "%future added value";
export type Category = "ACCOMMODATION" | "ACTIVITIES" | "DINING" | "GROCERIES" | "HOME" | "OTHER" | "TRANSPORT" | "%future added value";
export type Currency = "USD" | "%future added value";
export type GroupKind = "ORDINARY" | "TRIP" | "%future added value";
export type ProblemCode = "AMOUNT_OVERFLOW" | "FORBIDDEN" | "INVALID_CURSOR" | "INVALID_INPUT" | "NOT_FOUND" | "UNAVAILABLE" | "%future added value";
export type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "%future added value";
import { FragmentRefs } from "relay-runtime";
export type activityFeed$data = {
  readonly __typename: "ActivityConnection";
  readonly edges: ReadonlyArray<{
    readonly cursor: string;
    readonly node: {
      readonly after: {
        readonly allocations: ReadonlyArray<{
          readonly amountMinor: string;
          readonly participant: {
            readonly displayName: string;
            readonly id: string;
          };
          readonly percentageHundredths: number | null | undefined;
        }>;
        readonly category: Category;
        readonly description: string;
        readonly effectiveDate: string;
        readonly note: string;
        readonly payer: {
          readonly displayName: string;
          readonly id: string;
        };
        readonly split: SplitMode;
        readonly totalMinor: string;
      } | null | undefined;
      readonly amountMinor: string;
      readonly before: {
        readonly allocations: ReadonlyArray<{
          readonly amountMinor: string;
          readonly participant: {
            readonly displayName: string;
            readonly id: string;
          };
          readonly percentageHundredths: number | null | undefined;
        }>;
        readonly category: Category;
        readonly description: string;
        readonly effectiveDate: string;
        readonly note: string;
        readonly payer: {
          readonly displayName: string;
          readonly id: string;
        };
        readonly split: SplitMode;
        readonly totalMinor: string;
      } | null | undefined;
      readonly creator: {
        readonly displayName: string;
        readonly id: string;
      };
      readonly currency: Currency;
      readonly description: string;
      readonly effectiveDate: string;
      readonly groupId: string;
      readonly groupKind: GroupKind;
      readonly groupName: string;
      readonly id: string;
      readonly isHousehold: boolean;
      readonly kind: ActivityKind;
      readonly note: string;
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

(node as any).hash = "29357ddf4d198996c9b437d3dad4ddc4";

export default node;
