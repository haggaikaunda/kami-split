# #85 implementation slices

Status: scoped follow-up work, gated on adoption of [ADR-006](../decisions/006-group-creation.md). No implementation is delivered here.

| Order | Issue                                                                        | Prerequisites                                | Small deliverable                                                                                                          |
| ----- | ---------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1     | [#103 Persistence](https://github.com/haggaikaunda/kami-split/issues/103)    | #85 adopted; #75 complete                    | Additive trip metadata, atomic authorized creation and durable recovery, real-role/concurrency tests; no HTTP SDL          |
| 2     | [#104 API](https://github.com/haggaikaunda/kami-split/issues/104)            | #103, #78                                    | Implemented creation/recovery and minimal metadata reads using ADR-005 IDs/errors; coordinate shared Group fields with #82 |
| 3     | [#105 Navigation](https://github.com/haggaikaunda/kami-split/issues/105)     | #104, #83 (which retains its #82 dependency) | Authorized Groups/Trips discovery and scope-safe canonical routes, reusing first real expense/balance UI                   |
| 4     | [#106 Creation forms](https://github.com/haggaikaunda/kami-split/issues/106) | #104, #105                                   | Ordinary/trip form, actor-scoped same-attempt recovery, confirmed empty-group entry                                        |

Each issue contains observable acceptance criteria, exclusions and failure/concurrency/access test notes. All require the canonical independent testing/review and required CI gates. The chain is #103 → #104 → #105 → #106; #78 joins at #104 and #83 joins at #105. Existing issues keep their own prerequisites and scope; this work does not expand #73 or reopen #75.

#79/#80 supply explicit invitations and onboarding separately. Creation succeeds with just the creator before that integration exists; never simulate membership or show a dead invitation action. #81 provides the operational household/creator designation for a real installation; synthetic test fixtures do not require running bootstrap on real accounts. #84 ownership transfer and #86 consolidated dashboard/settlement design are not dependencies. Metadata editing/conversion and reporting remain outside these four slices.
