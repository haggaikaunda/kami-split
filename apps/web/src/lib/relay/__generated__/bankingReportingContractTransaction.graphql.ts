/**
 * @generated SignedSource<<4bbb7252704cc0d2afd60217bbaf66a0>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderInlineDataFragment } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type bankingReportingContractTransaction$data = {
  readonly amountMinor: string;
  readonly annotationRevision: string;
  readonly archives: ReadonlyArray<{
    readonly annotation: {
      readonly excluded: boolean;
      readonly note: string | null | undefined;
      readonly revision: string;
    } | null | undefined;
    readonly archiveId: string;
  }>;
  readonly current: boolean;
  readonly excluded: boolean;
  readonly id: string;
  readonly note: string | null | undefined;
  readonly sourceId: string;
  readonly sourceRevision: string;
  readonly " $fragmentType": "bankingReportingContractTransaction";
};
export type bankingReportingContractTransaction$key = {
  readonly " $data"?: bankingReportingContractTransaction$data;
  readonly " $fragmentSpreads": FragmentRefs<"bankingReportingContractTransaction">;
};

const node: ReaderInlineDataFragment = {
  "kind": "InlineDataFragment",
  "name": "bankingReportingContractTransaction"
};

(node as any).hash = "2ef9a3debcd5312222ccbcbaadee012f";

export default node;
