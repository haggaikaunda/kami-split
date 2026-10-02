# Production deployment configuration

## Status and scope

Issue [#140](https://github.com/haggaikaunda/kami-split/issues/140) approves
the first production deployment: Vercel for the web application, Google Cloud
Run for the Go API, hosted Supabase for Auth/PostgreSQL, and GitHub Actions as
the only deployment orchestrator. This document defines names, configuration
ownership, the provisioned production foundation, and operating procedures. It
does not store a credential or authorize deploying from a pull request.

There is one `Production` environment and no staging environment. Merges to
`main` may deploy only after the existing required `Verify` gate succeeds.
Pull-request runs cancel superseded CI work. Runs for `main` are non-canceling,
and the standalone deployment workflow uses a non-canceling `production` concurrency
group, so a new merge waits for an in-progress migration and deployment instead
of interrupting it.

## Resource identity

Stable names avoid making workflow behavior depend on provider-generated
display labels. Provider account and locality values remain explicit inputs.

| Resource                          | Stable name or format                                                         |
| --------------------------------- | ----------------------------------------------------------------------------- |
| Google Cloud project display name | `Kami Finances Production`                                                    |
| Google Cloud project parent       | `No organization`                                                             |
| Google Cloud project ID           | `kami-finances-production`                                                    |
| Google Cloud project number       | `598147484786`                                                                |
| Google Cloud billing              | Linked; billing account identifier is not stored in the repository            |
| GitHub environment                | `Production`                                                                  |
| Deployment concurrency group      | `production`                                                                  |
| Artifact Registry repository      | `kami-split`                                                                  |
| API image                         | `${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/kami-split/api:${DEPLOY_SHA}` |
| Cloud Run service                 | `kami-split-api`                                                              |
| Cloud Run runtime service account | `kami-split-api@kami-finances-production.iam.gserviceaccount.com`             |
| GitHub deployer service account   | `github-kami-split-deploy@kami-finances-production.iam.gserviceaccount.com`   |
| Workload Identity pool            | `github-actions`                                                              |
| Workload Identity provider        | `kami-split`                                                                  |
| Vercel project                    | `kami-split-web`                                                              |
| Vercel root directory             | `apps/web`                                                                    |

The Google Cloud display name intentionally differs from the GitHub repository
`haggaikaunda/kami-split`. The display name can change, but the confirmed project
ID `kami-finances-production` is the globally unique, permanent deployment
identifier and the value of `GCP_PROJECT_ID`. Using `No organization` is
appropriate for the initial personally owned deployment and does not change the
repository restriction on GitHub's Workload Identity provider.

The billing account has an alerts-only monthly budget named
`Kami Finances Production - $0 Target` with a `$1` comparison amount and actual
spend alerts at 50%, 80%, and 100%. It currently covers all services in the
billing account, which is functionally the production project while that is the
only linked project. This budget does not enforce a cap or guarantee zero cost.
Before linking another project to the account, replace or supplement it with a
budget scoped specifically to `kami-finances-production` and verify the alert
recipients. Production resources must stay within applicable free-tier limits.

The selected Supabase project is in AWS `us-west-2` (Oregon), so `GCP_REGION`
is `us-west1`, Google Cloud's Oregon region, for Cloud Run and Artifact
Registry. Do not default locality from a developer workstation or GitHub runner
location.

## Provisioned production foundation

The following production foundation was provisioned on 2026-10-01. The first
successful production workflow creates the Cloud Run service; there is no
billable always-on compute because the service keeps a minimum instance count of
zero.

- Enabled APIs: Cloud Run Admin, Artifact Registry, Secret Manager, IAM Service
  Account Credentials, Security Token Service, and Cloud Resource Manager.
- Artifact Registry repository `kami-split` is a regional Standard Docker
  repository in `us-west1` using Google-managed encryption. Immutable tags and
  vulnerability scanning are disabled. Cleanup deletes images older than seven
  days while retaining the two most recent versions.
- Runtime identity:
  `kami-split-api@kami-finances-production.iam.gserviceaccount.com`.
- Keyless deployment identity:
  `github-kami-split-deploy@kami-finances-production.iam.gserviceaccount.com`.
  Neither service account has a user-managed key.
- Workload Identity pool `github-actions` contains OIDC provider `kami-split`
  with issuer `https://token.actions.githubusercontent.com` and provider resource
  name
  `projects/598147484786/locations/global/workloadIdentityPools/github-actions/providers/kami-split`.
- The provider maps `google.subject` from `assertion.sub`,
  `attribute.repository` from `assertion.repository`, and `attribute.ref` from
  `assertion.ref`. Its condition permits only repository
  `haggaikaunda/kami-split` on `refs/heads/main`.
- The repository principal set for `haggaikaunda/kami-split` may impersonate only
  the deployment identity. The deployment identity has Cloud Run Developer on
  the project, Artifact Registry Writer on only the `kami-split` repository, and
  Service Account User on only the API runtime identity. It has no Secret Manager
  payload access.
- A project custom role grants only `run.services.getIamPolicy` and
  `run.services.setIamPolicy`. Its conditional binding limits the deployment
  identity to the `kami-split-api` service in `us-west1`, allowing the workflow
  to maintain that service's unauthenticated invoker policy without granting
  general Cloud Run administration.
- Regional Secret Manager containers were created in `us-west1` for
  `kami-split-database-url`, `kami-split-cursor-signing-keys`,
  `kami-split-invitation-keys`, `kami-split-onboarding-auth-admin-key`, and
  `kami-split-resend-api-key`. The runtime identity has Secret Accessor on only
  these five containers. Each container has an enabled initial version; payloads
  are not stored in GitHub or the repository.
- `kami-split-supabase-ca` is a separate global Secret Manager container because
  Cloud Run does not support regional secrets for file-volume mounts. The runtime
  identity also has Secret Accessor on only this global container; the deployment
  identity has no payload access.
- The project-created default Compute Engine service account has no project-level
  `Editor` grant. Application workloads use the dedicated identities above.
- Vercel project `kami-split-web` uses repository root `apps/web`, has
  provider-native Git deployment disabled, and owns the custom production domain
  `finances.mckardah.com`.
- The Resend sending domain is verified through Squarespace DNS. Hosted Supabase
  uses its restricted SMTP credential with sender
  `invites@finances.mckardah.com` and customer-facing name `Kami Finances`.
- Hosted Supabase Auth uses `https://finances.mckardah.com` as its Site URL,
  allows the `/auth/confirm` callback, disables public signup, requires email
  confirmation, and uses branded invitation and password-reset templates.

Never put an API runtime or database secret payload in a command argument,
repository file, or workflow log. Secret versions are maintained directly in
Secret Manager and referenced by Cloud Run. Vercel's documented CI
authentication is the narrow exception: the GitHub-masked `VERCEL_TOKEN` is
available only to the credential-validation and pinned Vercel
CLI steps on an ephemeral hosted runner, and the CLI receives it through its
documented `--token` flag. Do not echo it, enable shell tracing, forward it to the
application build/runtime, or reuse this exception for another credential.

| Selected Supabase value             | Production selection                         |
| ----------------------------------- | -------------------------------------------- |
| Project name                        | `kami-split`                                 |
| Project reference                   | `zlxpapkxacnwnmgagbth`                       |
| API origin                          | `https://zlxpapkxacnwnmgagbth.supabase.co`   |
| Provider region                     | AWS `us-west-2` — West US (Oregon)           |
| Colocated Google Cloud region       | `us-west1` — Oregon                          |
| Current database connection ceiling | Verify after project provisioning completes. |

The production web origin is the canonical HTTPS Vercel domain or custom
domain, without a trailing slash. The production API origin is the HTTPS Cloud
Run service URL, also without a trailing slash. The web application sends
browser GraphQL traffic to its same-origin `/api/graphql` route; that server
route forwards to the fixed API origin. The Go API therefore does not need a
broad browser CORS allowance. `ONBOARDING_ORIGIN` remains the exact allowlisted
web origin checked by both sides of the proxy.

## GitHub production environment

The GitHub `Production` environment owns deployment selection variables and the
three deploy-runner credentials. The standalone deployment workflow binds that
environment only after a successful `CI` workflow triggered by a push to `main`;
pull-request CI cannot receive these credentials. Environment protection should
restrict deployment to `main` and may require an operator approval if the
repository plan supports it.

Repository or environment variables are non-secret identifiers:

| Variable                                   | Contract                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `GCP_PROJECT_ID`                           | Selected Google Cloud project ID.                                                                        |
| `GCP_REGION`                               | `us-west1`.                                                                                              |
| `GCP_ARTIFACT_REPOSITORY`                  | `kami-split`.                                                                                            |
| `GCP_CLOUD_RUN_SERVICE`                    | `kami-split-api`.                                                                                        |
| `GCP_RUNTIME_SERVICE_ACCOUNT`              | `kami-split-api@kami-finances-production.iam.gserviceaccount.com`.                                       |
| `GCP_WORKLOAD_IDENTITY_PROVIDER`           | `projects/598147484786/locations/global/workloadIdentityPools/github-actions/providers/kami-split`.      |
| `GCP_DEPLOY_SERVICE_ACCOUNT`               | `github-kami-split-deploy@kami-finances-production.iam.gserviceaccount.com`.                             |
| `SUPABASE_PROJECT_REF`                     | `zlxpapkxacnwnmgagbth`.                                                                                  |
| `SUPABASE_PUBLISHABLE_KEY`                 | Publishable/anonymous key for the selected project.                                                      |
| `PRODUCTION_WEB_ORIGIN`                    | Canonical HTTPS web origin without a trailing slash.                                                     |
| `PRODUCTION_API_ORIGIN`                    | Optional first run; when set, must equal the discovered HTTPS Cloud Run origin without a trailing slash. |
| `INVITATION_FROM`                          | Verified sender address `invites@finances.mckardah.com`.                                                 |
| `DATABASE_URL_SECRET_VERSION`              | Positive numeric version of `kami-split-database-url` selected for the release.                          |
| `SUPABASE_CA_SECRET_VERSION`               | Positive numeric version of `kami-split-supabase-ca` selected for the release.                           |
| `CURSOR_SIGNING_KEYS_SECRET_VERSION`       | Positive numeric version of `kami-split-cursor-signing-keys` selected for the release.                   |
| `INVITATION_KEYS_SECRET_VERSION`           | Positive numeric version of `kami-split-invitation-keys` selected for the release.                       |
| `ONBOARDING_AUTH_ADMIN_KEY_SECRET_VERSION` | Positive numeric version of `kami-split-onboarding-auth-admin-key` selected for the release.             |
| `RESEND_API_KEY_SECRET_VERSION`            | Positive numeric version of `kami-split-resend-api-key` selected for the release.                        |
| `VERCEL_ORG_ID`                            | Vercel account or team identifier that owns the project.                                                 |
| `VERCEL_PROJECT_ID`                        | Vercel project identifier for `kami-split-web`.                                                          |

Environment secrets are credentials needed by the deployment runner, not API
runtime configuration. Each secret is scoped to only the validation and provider
steps that consume it; checkout, setup, build, readiness, and smoke-test steps do
not receive these credentials:

| Secret                  | Purpose                                                                           |
| ----------------------- | --------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | Authenticate the pinned Supabase CLI for the selected project.                    |
| `SUPABASE_DB_PASSWORD`  | Apply committed migrations with the migration identity; never pass it to the API. |
| `VERCEL_TOKEN`          | Deploy the selected Vercel project from GitHub Actions.                           |

Google Cloud authentication uses GitHub OIDC and Workload Identity Federation.
Do not create or store a service-account JSON key. Limit the provider attribute
condition to this repository, and grant the deployer only the Artifact Registry,
Cloud Run deployment, and runtime-service-account impersonation permissions
needed by the workflow. The deployment identity does not read runtime secret
payloads.

## API runtime configuration

Cloud Run owns non-secret API settings. Sensitive values live in Google Secret
Manager and are exposed to the runtime through Cloud Run secret references. Each
release pins positive numeric versions selected by the GitHub environment; never
bind an environment variable to the mutable `latest` alias. The runtime service
account receives access only to the named secret containers whose versions it
uses. Production values never belong in Compose, checked-in environment files,
PR jobs, workflow logs, or command output.

| Cloud Run variable           | Source and requirement                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `API_ADDR`                   | Literal `:8080`; the service listens on all container interfaces.                                   |
| `API_SHUTDOWN_TIMEOUT`       | `5s`; keep Cloud Run termination grace longer than this value.                                      |
| `DATABASE_MAX_CONNS`         | Start at `5`; multiply by the Cloud Run maximum instance count when budgeting Supabase connections. |
| `DATABASE_TIMEOUT`           | `2s`.                                                                                               |
| `AUTH_ISSUER`                | Selected Supabase Auth issuer.                                                                      |
| `AUTH_AUDIENCE`              | Supabase authenticated-user audience.                                                               |
| `AUTH_JWKS_URL`              | HTTPS JWKS endpoint for the same Supabase project.                                                  |
| `ONBOARDING_AUTH_URL`        | HTTPS Supabase Auth URL ending in `/auth/v1`.                                                       |
| `ONBOARDING_AUTH_PUBLIC_KEY` | Publishable/anonymous key for the same Supabase project.                                            |
| `ONBOARDING_ORIGIN`          | Exact `PRODUCTION_WEB_ORIGIN`.                                                                      |
| `INVITATION_FROM`            | Verified production sender address.                                                                 |

| Secret Manager value                   | Runtime contract                                                                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kami-split-database-url`              | Restricted `kami_api` PostgreSQL URL with `sslmode=verify-full&sslrootcert=/var/run/secrets/kami-split/supabase-ca.crt`; never a migration or owner login.                             |
| `kami-split-supabase-ca`               | Global (not regional) secret containing the Supabase project server root certificate, mounted read-only at `/var/run/secrets/kami-split/supabase-ca.crt`; it is public trust material. |
| `kami-split-cursor-signing-keys`       | JSON keyring consumed by `CURSOR_SIGNING_KEYS`.                                                                                                                                        |
| `kami-split-invitation-keys`           | JSON keyring consumed by `INVITATION_KEYS`.                                                                                                                                            |
| `kami-split-onboarding-auth-admin-key` | Supabase Auth administrative credential consumed by `ONBOARDING_AUTH_ADMIN_KEY`.                                                                                                       |
| `kami-split-resend-api-key`            | Delivery credential consumed by `RESEND_API_KEY`.                                                                                                                                      |

Download the CA certificate from the selected Supabase project's Database
Settings and store its PEM bytes as a version of a **global**
`kami-split-supabase-ca` Secret Manager container; do not select a regional
secret because Cloud Run secret-volume mounts do not support them. Grant
`roles/secretmanager.secretAccessor` on only that secret to
`kami-split-api@kami-finances-production.iam.gserviceaccount.com`. Although a
root certificate is public trust material rather than a credential, Secret
Manager gives Cloud Run a read-only file mount and lets each release pin the
exact certificate version. The URL must name that mounted path; downloading or
storing the certificate without `sslrootcert` does not configure pgx to use it.
Rotate the CA and URL selections together when Supabase replaces the project
certificate.

`CURSOR_ACTIVE_KEY_ID` and `INVITATION_ACTIVE_KEY_ID` are non-secret identifiers
that select entries in their secret keyrings. Key rotation adds a new key,
creates a new Secret Manager version, updates the matching GitHub environment
version variable, deploys the expanded keyring, changes the active ID, and
retains old keys while records or cursors signed by them remain valid. Credential
rotation follows the same version-selection step. Keep versions used by retained
Cloud Run revisions enabled so an emergency rollback restores the revision's
known-good configuration; disable an old version only after its revisions are no
longer rollback candidates.

Cloud Run must use request-based billing, allow scale-to-zero, and begin with a
maximum instance count of `1`. The onboarding flow currently keeps its
short-lived browser context in process memory and does not support routing a
follow-up request to another instance. With five database connections this
budgets at most five API pool connections; migration and provider connection use
remain separate. Confirm the new project's database ceiling after provisioning
and recheck it after any compute-plan change. Raising the instance cap first
requires durable shared onboarding context (or a separately reviewed routing
design), measured traffic, and a confirmed total connection budget.

The container liveness endpoint is `/health`. Deployment readiness and the
post-deploy API smoke check use `/ready`, which checks the configured database
and authentication key source. The public GraphQL health field is an additional
transport assertion, not a substitute for dependency readiness. Production probes
use these Cloud Run-safe paths to avoid routing limitations affecting paths ending
in `z`. The equivalent `/healthz` and `/readyz` endpoints remain available for
local development and backward compatibility.

## Vercel production configuration

Vercel uses Node 24, pnpm 11.25.0, the repository lockfile, and the existing
monorepo build commands described in [repository layout](../repository-layout.md).
Provider-native Git push deployment must not race GitHub Actions; production is
deployed by the serialized GitHub workflow after migrations and API readiness
succeed. The workflow passes the Cloud Run URL discovered during that same run
to Vercel, which allows the initial deployment before a Cloud Run service URL is
known. After the first successful run, record that URL as
`PRODUCTION_API_ORIGIN`; later runs fail before web deployment if the configured
value and actual service URL differ.

| Vercel production variable       | Value                                             |
| -------------------------------- | ------------------------------------------------- |
| `ONBOARDING_ORIGIN`              | Exact `PRODUCTION_WEB_ORIGIN`.                    |
| `ONBOARDING_API_URL`             | Exact `PRODUCTION_API_ORIGIN`.                    |
| `ONBOARDING_PUBLIC_SUPABASE_URL` | HTTPS API root for the selected Supabase project. |
| `ONBOARDING_PUBLIC_SUPABASE_KEY` | Publishable/anonymous key for that project.       |

Only the last two values are returned through the public onboarding
configuration route. The Supabase publishable key is designed for clients; RLS,
verified API identity, and server authorization remain the security boundary.

## Supabase production configuration

The hosted project supplies Auth, PostgreSQL, issuer/JWKS values, and the
restricted runtime and migration identities. Configure its Site URL as
`PRODUCTION_WEB_ORIGIN` and allow only the production confirmation/recovery
callback paths required by the onboarding guide. Production migration execution
uses the pinned Supabase CLI and committed `supabase/migrations`; the API never
migrates on startup and the deployment workflow never resets production.

The following operator selections have been recorded and verified:

- `us-west1` was selected from the actual Supabase region for the
  confirmed `kami-finances-production` Google Cloud project.
- Hosted Supabase Auth/JWKS endpoints, publishable key, restricted runtime
  database URL, and migration credential are configured.
- The canonical Vercel production origin, organization ID, and project ID are in
  the GitHub `Production` environment.
- The invitation sender domain and address are verified.
- The Cloud Run service URL is discovered during deployment and must be recorded
  as `PRODUCTION_API_ORIGIN` after the first successful run.

The standalone production workflow listens for completion of `CI` on `main` and
runs only when the triggering CI event was a successful push. It checks out and
deploys the exact triggering `workflow_run.head_sha`, not the deployment
workflow's own default-branch SHA. Its non-canceling `production` concurrency
group queues releases, validates the selected project identifiers and numeric
Secret Manager versions, builds and pushes an API image tagged with the triggering
commit SHA, resolves that tag to its immutable digest, applies migrations with
the pinned Supabase CLI, deploys a new Cloud Run revision from the digest and
pinned secret versions, and verifies that exact tagged revision
through `/health` and `/ready` before explicitly directing 100% of service
traffic to it. Existing services receive a candidate with zero traffic (`--no-traffic`). For the
first deployment only, a successful empty service lookup permits creation without
that flag because Cloud Run rejects it for a new service. The first revision is
therefore reachable before the workflow readiness checks; no prior API revision
exists to preserve. Web deployment still waits for candidate and service readiness.
Failed or unexpected service lookups stop deployment instead of being treated as
service absence. `bash scripts/cloud-run-traffic-flag-test.sh` exercises first
creation, existing-service staging, and lookup failure paths in API CI.

Core API configuration is validated before authentication,
migration, or deployment. Web-specific configuration and the optional canonical
API-origin assertion are validated after the API is healthy but before Vercel is
changed.
Only after the API passes readiness does the web job use a pinned Vercel CLI
release to create a staged production build with the exact API, Supabase, and
canonical-origin settings. Read-only preflight checks exercise the staged page,
public Supabase configuration route, and GraphQL health request before the build
is promoted to the production domain. The same checks then run against the
canonical domain. A failed migration, API deployment, web build, or staged
preflight therefore leaves the existing web deployment in place instead of
publishing a knowingly incompatible frontend.

## Deploy, rollback, and recovery

Normal production deployment is automatic: merge the reviewed PR to `main` and
allow the required `Verify` job to pass. The production job is serialized and
cannot be canceled by a later merge. Do not deploy locally or directly from a
provider dashboard. To redeploy the same commit after a transient provider
failure, rerun the failed GitHub Actions workflow. Confirm both Cloud Run
readiness endpoints and the hosted smoke checks before considering the run
recovered.

The normal rollback path is a new reviewed PR that reverts or fixes the change,
followed by the same workflow. Database migrations are forward-only: never reset
production or apply an unreviewed destructive down migration. If a schema change
must be repaired, add a safe forward migration that remains compatible with the
currently deployed API and web application.

For an incident that cannot wait for a PR:

1. Confirm the last known-good revision still references enabled numeric Secret
   Manager versions, then direct 100% of `kami-split-api` traffic in `us-west1`
   to that revision. Verify `/health` and `/ready` on the service URL.
2. If the web release is incompatible with that API, use Vercel's production
   rollback to restore the matching known-good deployment and verify
   `https://finances.mckardah.com` plus its GraphQL health request.
3. Record the incident and immediately reconcile `main` with a revert or fix.
   Provider rollback changes are temporary state; the next successful workflow
   otherwise replaces them.
4. Run the complete production workflow again so the repository, API revision,
   database state, and web deployment return to one auditable version.

Use `gcloud run services update-traffic kami-split-api --region us-west1
--project kami-finances-production --to-revisions REVISION=100` for the emergency
API traffic change. The next workflow stages and tests its exact candidate, then
explicitly assigns that revision 100% of traffic; it does not rely on Cloud Run's
remembered traffic split. To restore Cloud Run's default behavior outside the
workflow, use `gcloud run services update-traffic kami-split-api --region us-west1
--project kami-finances-production --to-latest`, but still reconcile `main` and
run the workflow afterward. Use `vercel rollback DEPLOYMENT_URL` for the web rollback;
Vercel Hobby plans support rolling back to the immediately previous production
deployment. `vercel rollback status` inspects the active rollback and
`vercel promote DEPLOYMENT_URL` restores a selected deployment when undoing it.

## Future staging environment

Add staging as separate provider resources and a separate GitHub environment,
never as alternate values in `production`. Give it its own Supabase project,
Cloud Run service/runtime secrets, Vercel project/domain, Workload Identity
restriction, and non-canceling concurrency group. Reuse the same ordered flow:
checks, migration, immutable API deployment, readiness, web deployment, then
hosted read-only smoke tests.
