/**
 * @generated SignedSource<<6b803b32dcc99ff2fbb5cebc7254acc1>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderInlineDataFragment } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type managementImpact$data = {
  readonly annotationCount: number;
  readonly count: number;
  readonly fromDate: string | null | undefined;
  readonly pendingCount: number;
  readonly spendingMinor: string;
  readonly throughDate: string | null | undefined;
  readonly unresolvedCount: number;
  readonly " $fragmentType": "managementImpact";
};
export type managementImpact$key = {
  readonly " $data"?: managementImpact$data;
  readonly " $fragmentSpreads": FragmentRefs<"managementImpact">;
};

const node: ReaderInlineDataFragment = {
  "kind": "InlineDataFragment",
  "name": "managementImpact"
};

(node as any).hash = "da83be5659d7d5dff21d34ebc6590e90";

export default node;
