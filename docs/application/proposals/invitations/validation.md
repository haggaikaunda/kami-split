# Design validation and implementation acceptance map

This package changes documentation only. No Auth, PostgreSQL concurrency, delivery
or browser test is claimed executed by writing these scenarios. Independent design
reviews and repository check outcomes are recorded on the PR. Shared-link scenarios
belong to #108; Auth/browser/transport scenarios belong to #80. #79 must complete
targeted lifecycle, durable recovery, admission and restricted-role/race evidence.

| Requirement                   | Required implementation evidence                                                                                                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email policy/current proof    | Identical comparison at create/provision/accept; trim/case, dots/plus, unsupported syntax, wrong/unverified/pending/changed email, subject mismatch, Auth failure, stale evidence after lock wait. Explicit sampled-evidence race test.                                                 |
| Targeted uniqueness/lifecycle | Real PostgreSQL concurrent same/different-group create; expired outstanding uniqueness; no duplicate send; exact link after resend; terminal cleanup; acceptance at/before/after expiry.                                                                                                |
| Transactions                  | Both orders of accept/accept, accept/revoke, accept/resend, resend/revoke, competing resends; provider outside locks; rollback/cancellation/unknown commit recovery; no duplicate identity/membership.                                                                                  |
| Shared first-time policy      | Explicit Join, forwarded recipient, preview without joining, no-email create/copy/renew, multi-person joins, duplicates, different links same actor, join/renew/revoke/expiry races, no retroactive member removal.                                                                     |
| Former members                | Old accepted targeted link denied; old saved shared link and renewal alone denied; inactive never first-time; shared first-time-only denial; new targeted invitation issued after departure; retained membership ID/ordinary role/full history. No disabled or tombstoned reactivation. |
| Owner controls                | Ordinary/former owner/cross-group/disabled denial; transfer serialization; list/copy/renew/revoke authorization; receipt cannot bypass current access.                                                                                                                                  |
| Cryptography                  | RNG failure, nonce uniqueness, tamper/AAD, key unavailable/rotation, exact-token reuse, correct targeted/shared terminal cleanup, no ordinary token projections/logs.                                                                                                                   |
| Delivery                      | Commit/send failure, ambiguous timeout, crash before dispatch/after provider acceptance, same-key payload replay, expired provider window, new deliberate resend, retry after revoke/accept/owner transfer; shared generates zero application intents.                                  |
| Auth/provision/recovery       | Signup disabled; new/existing/duplicate/interrupted synthetic user; verified email required; capability invalidated before completion; precreated bootstrap account recovery; no real recipients/secrets or automatic email identity linking.                                           |
| Privacy/browser               | Two-field valid preview; generic invalid responses; no account enumeration; wrong account without target disclosure; callback allowlist/state/CSRF; no-referrer/no-store; token scrubbing; account-switch/unmount/session expiry and late-response isolation.                           |
| UI                            | Separate saved/send states, loading/error/empty, unknown recovery without new action, explicit forwarded/full-history warning, no implicit Join; keyboard/focus, 320px, 200% text, desktop.                                                                                             |
| Database security             | Fresh replay/upgrade/desired-state agreement; real restricted roles, missing claims, alternate pooled subjects, no direct membership writes/Auth grants, proof mismatch/cross-group denial; no pre-departure capability becomes new readmission authority.                              |

Design checks: verify local links, formatting and accurate source reconciliation.
Repository required checks remain mandatory; documentation-only scope does not waive
CI Verify. Runtime health-only SDL and generated code must remain unchanged.
