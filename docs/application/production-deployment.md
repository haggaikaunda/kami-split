# Production deployment configuration

## Status and scope

Issue [#140](https://github.com/haggaikaunda/kami-split/issues/140) approves
the first production deployment: Vercel for the web application, Google Cloud
Run for the Go API, hosted Supabase for Auth/PostgreSQL, and GitHub Actions as
the only deployment orchestrator. This document defines names, configuration
ownership, provisioned Google Cloud foundation, and the remaining
operator-supplied values. It does not store a credential or authorize deploying
from a pull request.

There is one `production` environment and no staging environment. Merges to
`main` may deploy only after the existing required `Verify` gate succeeds.
Production deployments use a non-canceling `production` concurrency group so a
new merge waits for an in-progress migration and deployment instead of
interrupting it.

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
| GitHub environment                | `production`                                                                  |
| Deployment concurrency group      | `production`                                                                  |
| Artifact Registry repository      | `kami-split`                                                                  |
| API image                         | `${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/kami-split/api:${GITHUB_SHA}` |
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

## Provisioned Google Cloud foundation

The following production foundation was provisioned on 2026-10-01. No Cloud Run
service, secret payload, or billable always-on compute was created in this step.

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
- Empty regional Secret Manager containers were created in `us-west1` for
  `kami-split-database-url`, `kami-split-cursor-signing-keys`,
  `kami-split-invitation-keys`, `kami-split-onboarding-auth-admin-key`, and
  `kami-split-resend-api-key`. The runtime identity has Secret Accessor on only
  these five containers. No container has a secret version yet.
- The project-created default Compute Engine service account has no project-level
  `Editor` grant. Application workloads use the dedicated identities above.

Cloud Run creation remains deferred until an immutable API image and the named
Secret Manager values are ready. Adding a version is a separate operator action;
never put a payload in a command argument, repository file, or workflow log.

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

The GitHub `production` environment owns deployment selection and credentials.
Pull-request workflows must not receive this environment or any of its secrets.
Environment protection should restrict deployment to `main` and may require an
operator approval if the repository plan supports it.

Repository or environment variables are non-secret identifiers:

| Variable                         | Contract                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GCP_PROJECT_ID`                 | Selected Google Cloud project ID.                                                                   |
| `GCP_REGION`                     | `us-west1`.                                                                                         |
| `GCP_ARTIFACT_REPOSITORY`        | `kami-split`.                                                                                       |
| `GCP_CLOUD_RUN_SERVICE`          | `kami-split-api`.                                                                                   |
| `GCP_RUNTIME_SERVICE_ACCOUNT`    | `kami-split-api@kami-finances-production.iam.gserviceaccount.com`.                                  |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/598147484786/locations/global/workloadIdentityPools/github-actions/providers/kami-split`. |
| `GCP_DEPLOY_SERVICE_ACCOUNT`     | `github-kami-split-deploy@kami-finances-production.iam.gserviceaccount.com`.                        |
| `SUPABASE_PROJECT_REF`           | `zlxpapkxacnwnmgagbth`.                                                                             |
| `SUPABASE_PUBLISHABLE_KEY`       | Publishable/anonymous key for the selected project.                                                 |
| `PRODUCTION_WEB_ORIGIN`          | Canonical HTTPS web origin without a trailing slash.                                                |
| `PRODUCTION_API_ORIGIN`          | Canonical HTTPS Cloud Run origin without a trailing slash.                                          |
| `VERCEL_ORG_ID`                  | Vercel account or team identifier that owns the project.                                            |
| `VERCEL_PROJECT_ID`              | Vercel project identifier for `kami-split-web`.                                                     |

Environment secrets are credentials needed by the deployment runner, not API
runtime configuration:

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
Manager and are exposed to the runtime through Cloud Run secret references. The
runtime service account receives access only to the named secret versions it
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

| Secret Manager value                   | Runtime contract                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `kami-split-database-url`              | Restricted `kami_api` PostgreSQL URL with `sslmode=verify-full`; never a migration or owner login. |
| `kami-split-cursor-signing-keys`       | JSON keyring consumed by `CURSOR_SIGNING_KEYS`.                                                    |
| `kami-split-invitation-keys`           | JSON keyring consumed by `INVITATION_KEYS`.                                                        |
| `kami-split-onboarding-auth-admin-key` | Supabase Auth administrative credential consumed by `ONBOARDING_AUTH_ADMIN_KEY`.                   |
| `kami-split-resend-api-key`            | Delivery credential consumed by `RESEND_API_KEY`.                                                  |

`CURSOR_ACTIVE_KEY_ID` and `INVITATION_ACTIVE_KEY_ID` are non-secret identifiers
that select entries in their secret keyrings. Key rotation adds a new key,
deploys the expanded keyring, changes the active ID, and retains old keys while
records or cursors signed by them remain valid.

Cloud Run must use request-based billing, allow scale-to-zero, and begin with a
maximum instance count of `1`. The onboarding flow currently keeps its
short-lived browser context in process memory and does not support routing a
follow-up request to another instance. With five database connections this
budgets at most five API pool connections; migration and provider connection use
remain separate. Confirm the new project's database ceiling after provisioning
and recheck it after any compute-plan change. Raising the instance cap first
requires durable shared onboarding context (or a separately reviewed routing
design), measured traffic, and a confirmed total connection budget.

The container liveness endpoint is `/healthz`. Deployment readiness and the
post-deploy API smoke check use `/readyz`, which checks the configured database
and authentication key source. The public GraphQL health field is an additional
transport assertion, not a substitute for dependency readiness.

## Vercel production configuration

Vercel uses Node 24, pnpm 11.25.0, the repository lockfile, and the existing
monorepo build commands described in [repository layout](../repository-layout.md).
Provider-native Git push deployment must not race GitHub Actions; production is
deployed by the serialized GitHub workflow after migrations and API readiness
succeed.

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

Before enabling deployment, record and verify these operator-supplied values:

- `us-west1` is already selected from the actual Supabase region for the
  confirmed `kami-finances-production` Google Cloud project.
- Hosted Supabase Auth and JWKS endpoints, publishable key, database endpoints, and connection ceiling after project provisioning completes.
- Canonical Vercel production origin, organization ID, and project ID.
- Verified invitation sender domain/address.
- Cloud Run service URL after the first immutable image and runtime secrets are
  ready.

The reusable production workflow is called by `ci.yml` only for a successful
`main` push after the required `Verify` job. It uses a non-canceling production
concurrency group, validates the selected project identifiers, builds and pushes
an API image tagged with the commit SHA, resolves that tag to its immutable
digest, applies migrations with the pinned Supabase CLI, deploys a new Cloud Run
revision from the digest, and verifies `/healthz` and `/readyz`. Missing or
inconsistent configuration fails before authentication, migration, or deployment.
Vercel deployment remains to be added after its project identifiers and canonical
production origin are available.
