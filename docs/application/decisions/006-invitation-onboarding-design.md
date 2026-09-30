# ADR-006: Coordinated invitation and onboarding design

- Status: accepted owner policies; engineering recommendations and remaining owner choices under review.
- Decision record date: 2026-09-30.
- Scope: #79 persistence/lifecycle/admission and #80 Auth/browser/email/thin adapter.

[The coordinated design](../proposals/invitations/README.md) links the current owner
approvals and reconciles the stale issue gates. It records accepted case-insensitive
trimmed invitation email matching without alias merging, committed-state preservation
on email failure, two-field valid-link preview, reusable owner-distributed group
links without application email, and immediate eligible first-time admission after
explicit Join, including forwarded recipients. These refine the targeted-only
wording in ADR-002 O01 and ADR-003 B5; they do not change targeted terminal states.

A shared join does not consume the link. Former-member shared-link policy is still
open: old saved links cannot silently undo departure/removal, and targeted-only is
not approved. Same membership identity, ordinary role, full history and disabled
account denial remain fixed by ADR-004. The decision sheet distinguishes five
remaining owner choices from concrete engineering recommendations. It does not
reopen #77/#93, ship features, grant database privileges, publish SDL or provision
hosted resources. #78 is a prerequisite for affected implementation, not design.

[Technical recommendations](../proposals/invitations/technical.md) specify kind-based
storage, lifecycle/lock/clock protocol, bounded external current-email evidence,
transactional action/delivery intent, provider-window retry, invite-eligible Auth,
callbacks, privacy and representative thin operations.
[Validation requirements](../proposals/invitations/validation.md) map acceptance
criteria to future runtime tests; writing them does not claim those tests passed.
