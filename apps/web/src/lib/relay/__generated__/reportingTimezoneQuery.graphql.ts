/**
 * @generated SignedSource<<d0cc1be8274679d33f4d36c90eb1aee5>>
 * @lightSyntaxTransform
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type reportingTimezoneQuery$variables = Record<PropertyKey, never>;
export type reportingTimezoneQuery$data = {
  readonly reportingTimezone: {
    readonly __typename: "ReportingTimezone";
    readonly timezone: string;
    readonly version: string;
  } | {
    readonly __typename: "ReportingTimezoneProblem";
    readonly code: string;
  } | {
    // This will never be '%other', but we need some
    // value in case none of the concrete values match.
    readonly __typename: "%other";
  };
};
export type reportingTimezoneQuery = {
  response: reportingTimezoneQuery$data;
  variables: reportingTimezoneQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "alias": null,
    "args": null,
    "concreteType": null,
    "kind": "LinkedField",
    "name": "reportingTimezone",
    "plural": false,
    "selections": [
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "__typename",
        "storageKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": [
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "timezone",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "version",
            "storageKey": null
          }
        ],
        "type": "ReportingTimezone",
        "abstractKey": null
      },
      {
        "kind": "InlineFragment",
        "selections": [
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "code",
            "storageKey": null
          }
        ],
        "type": "ReportingTimezoneProblem",
        "abstractKey": null
      }
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": [],
    "kind": "Fragment",
    "metadata": null,
    "name": "reportingTimezoneQuery",
    "selections": (v0/*:: as any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [],
    "kind": "Operation",
    "name": "reportingTimezoneQuery",
    "selections": (v0/*:: as any*/)
  },
  "params": {
    "cacheID": "9dad347b1045b32fa1691a0e371dc978",
    "id": null,
    "metadata": {},
    "name": "reportingTimezoneQuery",
    "operationKind": "query",
    "text": "query reportingTimezoneQuery {\n  reportingTimezone {\n    __typename\n    ... on ReportingTimezone {\n      timezone\n      version\n    }\n    ... on ReportingTimezoneProblem {\n      code\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "0c909222c56549dbb649b9265dfd925b";

export default node;
