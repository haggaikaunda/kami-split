/**
 * @generated SignedSource<<4efcf2868d5be33902d5487a2598f662>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderInlineDataFragment } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type personalTransactionDetail$data = {
  readonly accountId: string;
  readonly activity: string;
  readonly activityOverride: string | null | undefined;
  readonly amountMinor: string;
  readonly annotationRevision: string;
  readonly archives: ReadonlyArray<{
    readonly annotation: {
      readonly activity: string | null | undefined;
      readonly category: string | null | undefined;
      readonly excluded: boolean;
      readonly materialRevision: string;
      readonly note: string | null | undefined;
      readonly reviewed: boolean;
      readonly revision: string;
    } | null | undefined;
    readonly annotationRevision: string | null | undefined;
    readonly archiveId: string;
    readonly sourceRevision: string;
  }>;
  readonly authorizationDate: string | null | undefined;
  readonly bankDate: string;
  readonly bindingId: string;
  readonly category: string;
  readonly categoryOverride: string | null | undefined;
  readonly currency: string;
  readonly current: boolean;
  readonly currentId: string | null | undefined;
  readonly discrepancy: string;
  readonly eligible: boolean;
  readonly excluded: boolean;
  readonly latestSourceRevision: string;
  readonly mappingVersion: string;
  readonly materialConflict: boolean;
  readonly materialRevision: string;
  readonly merchantName: string | null | undefined;
  readonly name: string | null | undefined;
  readonly note: string | null | undefined;
  readonly processingState: string;
  readonly providerCategory: string | null | undefined;
  readonly providerCode: string | null | undefined;
  readonly providerConfidence: string | null | undefined;
  readonly providerPrimaryCategory: string | null | undefined;
  readonly reviewed: boolean;
  readonly sourceId: string;
  readonly sourceRevision: string;
  readonly " $fragmentType": "personalTransactionDetail";
};
export type personalTransactionDetail$key = {
  readonly " $data"?: personalTransactionDetail$data;
  readonly " $fragmentSpreads": FragmentRefs<"personalTransactionDetail">;
};

const node: ReaderInlineDataFragment = {
  "kind": "InlineDataFragment",
  "name": "personalTransactionDetail"
};

(node as any).hash = "e6799e993d6b75c605f5de25ee5ed657";

export default node;
