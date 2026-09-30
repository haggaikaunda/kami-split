# Administrative first-account bootstrap

Issue #81 implements [ADR-003 B1](decisions/003-bootstrap-groups-and-invitations.md#b1-explicit-administrative-bootstrap-o09)
using the existing [identity foundation](identity-foundation.md). This is a deliberate
operator procedure, separate from API/browser privileges and server startup.
It creates one application identity, one empty USD group named **Household**, its
sole active owner membership, and the installation's designated group creator.
The creator permission belongs to that stable application identity; ownership
transfer or an email change does not move it. It grants no access to other groups.

## Privileges and environment selection

Development and CI use only synthetic accounts, Mailpit and the single local
Supabase workflow in [database development](database-development.md). Use
`make db-test` for disposable integration verification. Do not create a second
migration runner, insert real records in seeds/migrations, or reset a shared stack.

**Executing this procedure against a hosted environment requires separate explicit
authorization.** This runbook and implementation do not authorize deployment,
hosted account creation, real email delivery or production bootstrap. Before any
separately authorized hosted run, verify project identity, migration version,
backup/recovery arrangements, TLS (`sslmode=verify-full` for PostgreSQL), email
configuration and the actual credential's supported permissions. Do not weaken
roles to make an unsupported provider environment work.

Two separate operator credentials are needed:

- `BOOTSTRAP_AUTH_URL`: the exact selected Supabase project's Auth URL ending in
  `/auth/v1`; HTTPS except loopback HTTP in local development.
- `BOOTSTRAP_AUTH_ADMIN_KEY`: an Auth administrative credential for that project.
  It must never reach the browser or ordinary API database role.
- `BOOTSTRAP_DATABASE_URL`: the exact database in the **same** project, using the
  existing migration login able to `SET ROLE kami_migrator`. The command has no
  fallback to `DATABASE_URL`, local defaults, or a discovered database.

Load secrets through a private operator environment/secret manager with shell
tracing disabled. Do not put credentials or email/password input on command lines,
in shell history, CI output, terminal recordings, tickets or Git. Do not enable
HTTP/SQL body logging. The helper prints only a returned Auth UUID or the static
application result; it suppresses raw provider/database errors. Keep the UUID
plan as restricted operator evidence, outside the checkout. Do not publish it.
Unset administrative credentials after use.

Keep public signup disabled and email confirmations enabled throughout. Follow
[onboarding configuration](onboarding.md#supabase-and-email-setup) for exact callback
origins, templates and local Mailpit or separately authorized SMTP configuration.
Never auto-confirm an address, enable signup temporarily, share the initial
password, or substitute an admin-generated sign-in link for emailed recovery.

## Explicit operation

Build the tool from a reviewed checkout (the binary is also outside the repository):

```sh
cd apps/api
go build -o /private/tmp/kami-bootstrap ./cmd/bootstrap
```

1. Inspect the selected project and record the intended first person. Auth creation
   is the supported [Supabase administrative create-user operation](https://supabase.com/docs/reference/javascript/auth-admin-createuser),
   outside the application transaction. Prepare a mode-0600 JSON input file in a
   private directory outside the checkout containing only `{"email":"…"}`.
   The ellipsis is a placeholder; never commit actual values. Invoke:

   ```sh
   /private/tmp/kami-bootstrap create-auth < "$PRIVATE_AUTH_INPUT" > "$PRIVATE_AUTH_RESULT"
   ```

   Create the private directory/files with `umask 077` before redirection. The
   command generates a fresh 256-bit random initial password only in process
   memory, requests `email_confirm: false`, and never outputs or retains the
   password. It sends no email. It returns only `authUserId`. There is no automatic
   provider retry or email lookup. After an uncertain failure, inspect the selected
   project's Auth administration and explicitly confirm the exact intended UUID
   before proceeding. Never create a replacement and silently relink by email.

2. Record the exact Auth UUID returned by that project. Generate three independent
   random UUID v4 values for application user, household group and owner membership
   (for example with Python's `uuid.uuid4()`). Save the following plan in a
   mode-0600 file outside the checkout, replacing every placeholder:

   ```json
   {
     "authUserId": "EXPLICIT_AUTH_UUID",
     "userId": "RANDOM_APPLICATION_USER_UUID_V4",
     "groupId": "RANDOM_HOUSEHOLD_UUID_V4",
     "membershipId": "RANDOM_OWNER_MEMBERSHIP_UUID_V4",
     "displayName": "Operator-selected display name"
   }
   ```

   Check both environment URLs and all identity values before invocation. For an
   already partially provisioned application user, inspect its immutable subject
   and live Auth link and retain its exact existing application UUID. Do not choose
   the earliest row, search by email, or guess IDs. The helper never generates a new
   plan on retry and never chooses the first user automatically.

3. Invoke the application transaction explicitly:

   ```sh
   /private/tmp/kami-bootstrap provision < "$PRIVATE_BOOTSTRAP_PLAN"
   ```

   `CREATED` means the user (or checked existing identity), group, owner membership
   and singleton are committed. `EXISTING` means all immutable links and active
   original ownership still match. Only the initial creation sets display name
   and Household name; a retry does not rename mutable profile/group data or
   require a household that has since been used to remain empty. Preserve this
   plan to inspect/recover an uncertain commit. Never replace it with fresh IDs.

4. The designated user opens the normal `/sign-in` **Forgot password** flow in the
   configured browser. Follow the delivered recovery email in the same browser,
   explicitly verify on `/auth/confirm`, set the actual password on
   `/auth/password`, then sign in and inspect `/account` and authorized household
   reads. This is #80's existing flow, not an operator-only password page.
   Recovery must establish a confirmed current email; the API rejects unverified
   identity. Password recovery never creates memberships or enables disabled
   application accounts. Invalid/expired links require restarting ordinary recovery.
   No provider error justifies bypassing verification.

## Atomicity, retries and partial failures

The application transaction uses READ COMMITTED and transaction-scoped advisory
lock `(81, 1)`, reserved for the installation bootstrap. It then uses the existing
invitation subject lock `hashtextextended(authSubject, 79)` to serialize competing
first provisioning. It locks the exact user before the group, rechecks links and
ownership, and forces deferred constraints before committing. Database uniqueness
and the managed Auth foreign key are additional safeguards. No new migration,
privileged database function, grants, background task or server endpoint is added.

| Observed state                                                                                                 | Safe next step                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth creation failed or its response was lost                                                                  | Inspect the explicitly selected Auth project. If the intended account exists, record its exact UUID; otherwise deliberately repeat creation. No automatic email relinking. |
| Auth exists but application transaction failed                                                                 | Retry the same reviewed plan. A rollback leaves no partial application setup. The unconfirmed account cannot obtain authorized access.                                     |
| Exact enabled application user exists, with matching subject/live link and no memberships; installation absent | Reuse that exact application ID. The transaction can complete the missing group/membership/installation.                                                                   |
| Commit response lost                                                                                           | Retry the same plan; either one setup is created or an exact existing setup is recognized. Concurrent identical attempts serialize; different plans conflict.              |
| Installation points to different identities or group                                                           | Stop and investigate; no reset, replacement singleton or automatic adoption.                                                                                               |
| Group/membership exists without installation, conflicting IDs, or existing user has historical membership      | Stop and inspect the partial state. The helper does not adopt groups or reconstruct removed memberships. Any manual repair needs a separately reviewed procedure.          |
| Ownership changed, original membership inactive/removed, user disabled or Auth link tombstoned                 | Bootstrap fails closed. Do not delete records, reactivate access or change IDs to force a rerun. Use the separately authorized lifecycle/admission process.                |
| Provider recovery does not deliver, verify, or establish a password                                            | Record a concrete integration blocker with redacted status/evidence. Keep signup disabled and verification required.                                                       |

The Auth service and PostgreSQL transaction cannot be atomic together. The tool
cannot guarantee delivery, infer an account after a lost creation response, or
protect against an operator who directly edits privileged tables outside the
protocol. It never deletes a partial Auth account or financial history. The
initial household is empty because only identity/group/membership/installation
rows are inserted. A successful later retry is observational and performs no DML.

## Verification

`make db-test` runs the bootstrap package on the same disposable migrated Supabase
stack as identity, invitation and onboarding tests. Tests cover explicit identity
selection, exact/concurrent retries, rollback recovery, conflicts, historical
membership/ownership, disabled access, runtime denial and real emailed provider
recovery leading to authorized household reads. Provider verification uses only
Mailpit's synthetic challenge and the public Auth verification endpoint; it never
marks an address confirmed through administrative SQL/API.

`go test ./internal/bootstrap/...` covers malformed plans, random initial password
creation, explicit unconfirmed creation, redacted failures and redirect refusal.
Existing #80 browser and provider tests cover callback state, expired/replayed
links, password UI and session handling. Hosted SMTP and real accounts are not
exercised by these tests. Full repository CI, independent requirements testing and
final-diff review remain required before merge.
