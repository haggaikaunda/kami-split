# Server-informed UI

## Status

This document records a presentation/API design principle for Kami Split. It guides contract design; it does not introduce a generic server-driven UI framework or authorize implementation outside an approved issue.

Kami Split starts with **server-informed UI**: the server owns authoritative domain meaning, authorization, complete financial aggregates, and business capabilities; clients own interaction, layout, navigation, accessibility, and responsive presentation. Selected read-heavy surfaces may later experiment with **server composition** using a small typed vocabulary of client-implemented sections.

See [API architecture](api-architecture.md) for the backend responsibilities that this principle builds on.

## Why

Financial clients must not reconstruct authoritative meaning from whichever records happen to be loaded. Pagination, authorization, concurrent writes, and multiple UI entry points make client inference unsafe for balances, obligations, and other complete summaries.

At the same time, Kami Split already has rich client behavior around forms, drafts, recovery, navigation, and accessibility. Encoding those interactions in a generic UI protocol would add a second application framework before there is evidence that it is needed.

The intended boundary is therefore:

- the **server** answers domain questions and returns authorized, complete, reusable projections;
- the **client** decides how those answers are presented and interacted with;
- future **server composition** may select and order known presentation sections when that creates meaningful reuse across surfaces.

## API design principles

### Return domain meaning, not ingredients for client inference

Prefer APIs that directly express the authorized result the UI needs. Complete balances, obligations, spending summaries, membership context, and applicable business capabilities should be computed from authoritative server state rather than reconstructed from a paginated expense list or scattered flags.

A capability exposed on a read is informational presentation state, not an authorization boundary. Every operation must still authenticate and authorize the current actor against current server state when it executes.

### Build reusable financial and reporting projections

Do not shape aggregate APIs around one React component tree or one dashboard when the underlying concept is reusable. Server-side projections should be capable of supporting multiple authorized perspectives without duplicating financial definitions.

Expected consumers include, over time:

- a household view of shared balances, groups, activity, and spending;
- group and trip views of spending and obligations;
- an individual spending view that can distinguish the viewer's shared/allocated spending from non-shared spending;
- future reporting surfaces that need the same underlying totals, breakdowns, or trends.

The exact model for **non-shared expenses** is intentionally unresolved. It may represent self-only participation inside an existing financial context or eventually require a distinct personal context. Contract work must not assume one model until that product and authorization decision is made.

### Keep the first GraphQL contract narrow

The first authenticated expense journey should expose only domain fields and outcomes justified by its real UI needs. It should not add generic `Section`, `Card`, layout, action-description, or arbitrary UI-schema types merely to prepare for possible server composition.

The production contract should also not preserve the preview's whole-household `Snapshot` shape simply because it is the current client seam. The GraphQL API should describe stable domain concepts and useful authorized projections.

## Client-owned behavior

Keep interaction mechanics in the client unless a later design demonstrates a clear reason to move them. This includes:

- expense entry and editing;
- draft state and immediate split previews;
- local interaction feedback;
- browser/app navigation and return context;
- focus restoration and accessibility behavior;
- responsive choice of panel, page, or other presentation form.

The server remains authoritative for validation and mutation outcomes when operations are submitted.

## Future server composition

Read-heavy dashboards are the strongest candidate for a later bounded experiment. If multiple surfaces repeatedly need different selections or orderings of the same known summaries, the server may return an ordered collection from a small, typed vocabulary of sections implemented by the client.

For example, a future composition layer might select known concepts such as group balances, recent activity, invitation status, or spending summaries. The server may choose which supported sections apply and provide their authorized content; the client still owns rendering and interaction.

Any such experiment should satisfy these constraints:

- use a small typed vocabulary rather than arbitrary nested layout JSON, CSS, or an expression language;
- keep actions explicit and allowlisted rather than sending executable operation descriptions;
- preserve normal domain authorization for every read and write;
- represent unavailable, denied, stale, loading, and empty financial states explicitly where relevant rather than manufacturing zero values;
- allow unsupported optional presentation sections to degrade safely without hiding required financial meaning;
- reuse the same underlying domain/reporting projections used by conventional fixed-layout clients.

A new interaction type may still require a client release. Server composition is not intended to make the client a universal renderer.

## Adoption sequence

1. Design conventional, strongly typed domain APIs according to server-informed UI principles.
2. Establish reusable server-side financial/reporting projections as real product surfaces require them.
3. For a suitable dashboard, compare a fixed client layout over typed queries with an ordered typed-section response.
4. Adopt server composition only if it materially improves reuse or independent composition while keeping the renderer and protocol small.

The consolidated household dashboard is a likely future experiment because its summaries are expected to be reused across household, group/trip, and individual spending surfaces. Server composition is not a prerequisite for the first persisted expense journey.
