/**
 * @generated SignedSource<<4ff8bf341c9c1089b28215a317eacdf4>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderFragment } from 'relay-runtime';
export type GroupKind = "ORDINARY" | "TRIP" | "%future added value";
import { FragmentRefs } from "relay-runtime";
export type discoveryCard$data = {
  readonly id: string;
  readonly isHousehold: boolean;
  readonly kind: GroupKind;
  readonly name: string;
  readonly trip: {
    readonly destination: string;
    readonly endDate: string;
    readonly startDate: string;
  } | null | undefined;
  readonly " $fragmentType": "discoveryCard";
};
export type discoveryCard$key = {
  readonly " $data"?: discoveryCard$data;
  readonly " $fragmentSpreads": FragmentRefs<"discoveryCard">;
};

const node: ReaderFragment = {
  "argumentDefinitions": [],
  "kind": "Fragment",
  "metadata": null,
  "name": "discoveryCard",
  "selections": [
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "id",
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
      "name": "kind",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "kind": "ScalarField",
      "name": "isHousehold",
      "storageKey": null
    },
    {
      "alias": null,
      "args": null,
      "concreteType": "GroupTrip",
      "kind": "LinkedField",
      "name": "trip",
      "plural": false,
      "selections": [
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "destination",
          "storageKey": null
        },
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "startDate",
          "storageKey": null
        },
        {
          "alias": null,
          "args": null,
          "kind": "ScalarField",
          "name": "endDate",
          "storageKey": null
        }
      ],
      "storageKey": null
    }
  ],
  "type": "GroupSummary",
  "abstractKey": null
};

(node as any).hash = "36d6f8d91a31e18e6788be257cc40c41";

export default node;
