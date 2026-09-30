# ADR-006: Coordinated invitation and onboarding design

- Status: accepted owner policies, including I1–I5; engineering protocols require implementation validation.
- Decision record date: 2026-09-30.
- Scope: #79 persistence/lifecycle/admission and #80 Auth/browser/email/thin adapter.

[The coordinated design](../proposals/invitations/README.md) links the current owner
approvals and reconciles the stale issue gates. It records accepted case-insensitive
trimmed invitation email matching without alias merging, committed-state preservation
on email failure, two-field valid-link preview, reusable owner-distributed group
links without application email, and immediate eligible first-time admission after
explicit Join, including forwarded recipients. These refine the targeted-only
wording in ADR-002 O01 and ADR-003 B5; they do not change targeted terminal states.

A shared join does not consume the link. The authoritative
[owner I1–I5 decisions](https://github.com/haggaikaunda/kami-split/pull/101#issuecomment-5904210048)
require new targeted invitations for former-member return; shared links admit
first-time members only. No shared readmission grant system is required. Stable
membership identity, ordinary role, full history and disabled-account denial remain
fixed. I2 approves one outstanding shared link/no use cap/current-owner management;
I3 requires terminal recipient/token cleanup and bounded delivery-material recovery;
I4 approves 15-minute access tokens and current-session logout.

Targeted invitations (#79) and onboarding (#80) are on #73’s critical path.
Reusable shared-link implementation is separately tracked in
[#108](https://github.com/haggaikaunda/kami-split/issues/108), without blocking it.
#78 is complete. After this design is reviewed/merged, #79 proceeds through normal
implementation gates; its issue stays open until implementation criteria pass.
This record does not itself ship features, publish SDL or provision resources.

[Technical recommendations](../proposals/invitations/technical.md) specify kind-based
storage, lifecycle/lock/clock protocol, bounded external current-email evidence,
transactional action/delivery intent, provider-window retry, invite-eligible Auth,
callbacks, privacy and representative thin operations.
[Validation requirements](../proposals/invitations/validation.md) map acceptance
criteria to future runtime tests; writing them does not claim those tests passed.
