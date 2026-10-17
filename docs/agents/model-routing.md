# Model routing and fresh assignments

The delivery coordinator applies this policy across issue preparation,
implementation, testing, review and closeout, using the [canonical workflow](delivery-workflow.md).
Keep the original chat on the user's selected model. Delegating a role does not
switch the coordinator's model. Already authorized delivery continues through
the existing gates without routine owner model selection.

## Choose and launch

| Work                                                                                | Initial model / effort                                        | Boundary                                                        |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- |
| Assessment and coordination                                                         | User's selected model and settings                            | Keep coordination brief; do not repeat delegated investigations |
| Ordinary builder / fixes                                                            | `gpt-6.1-sol` / `high`                                        | Smallest complete approved change                               |
| Independent requirements tester                                                     | `gpt-6.1-sol` / `high`                                        | Separate fresh context; requirements first; test-only edits     |
| Whole-final-diff reviewer                                                           | `gpt-6.1-sol` / `high`                                        | Separate fresh context; read the entire final diff              |
| Particularly difficult financial, authorization, concurrency or architecture review | `gpt-6-astra` / `high`                                        | State the difficult question; preserve whole-diff coverage      |
| Narrow inventory, formatting or records                                             | Deterministic scripts first; optional `gpt-6-luna` / `medium` | Bounded judgment with an independently verifiable result        |

These are pilot defaults, not performance or price guarantees. Select effort
explicitly and confirm that the launch surface supports the chosen combination.
Before delegation, inventory the tools actually exposed, model/effort choices,
fresh-context support, available context identifiers, permissions and owned
resources. Tool metadata establishes supported launch choices, not successful
execution or account entitlement. A CLI binary/help listing establishes only
that local interface; do not infer its model access from app tool metadata.

Use fresh contexts for cross-model assignments and all independent roles. With
the current `collaboration.spawn_agent` surface, set `fork_turns="none"`,
`model` and `reasoning_effort` explicitly. Full-history forks inherit the parent
model/effort and reject overrides. Recheck the actual surface rather than assuming
these names work in every runtime. Do not paste the full chat into a fresh prompt.
If fresh delegation is unavailable, use an available separate context with the
assignment below; missing independence blocks that gate, not unrelated work.

[Native profiles](../../.codex/agents/kami-builder.toml) provide builder, tester,
reviewer, difficult reviewer and narrow assistant settings in `.codex/agents/`.
[Official OpenAI documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents)
defines standalone project TOML files with `name`, `description`,
`developer_instructions`, `model` and `model_reasoning_effort`. Profiles inherit
parent permissions/provider/tools; instructions are not a security sandbox.
Confirm discovery on the actual runtime before using a profile. If unavailable,
pass the explicit model/effort and linked role guidance through supported launch
tools. A file on disk does not prove runtime discovery or execution.

Keep the pilot's standard-speed preference without silently changing the root
session or global configuration. Native agents inherit the root service tier;
record a differing inherited preference as a limitation. Do not claim a profile
changes speed. No settings, credentials or protections need changing here.

## Compact assignment

Fill this non-live outline with authoritative links and exact observations:

```text
Role and boundary: builder | independent tester | whole-final-diff reviewer
Approved goal: live issue URL; approval provenance; scope revision; criteria IDs;
  smallest outcome, exclusions, dependencies and authoritative design inputs.
Repository: expected remote; exact base/head (or head not yet created); branch;
  absolute worktree path; any intentional dependent base.
Guidance: root/area AGENTS, canonical workflow, relevant task-map rows and role
  prompt; relevant source to inspect. Read live source before acting.
Launch: explicit supported model/effort; fresh context; routing reason; finite
  budget/stop condition. Report configured versus observed settings honestly.
Resources: owner; allowed writes; exclusive ports/services/databases/build output;
  protected/unowned checkouts; ownership transfer/cleanup handoff.
Output: exact candidate/tested/reviewed revision, criteria coverage or whole-diff
  findings, commands/outcomes/limitations and owner/next action; owning issue/PR
  evidence destination and current index. No committed run reports.
```

The tester derives scenarios from the issue before reading the builder's
conclusions; the reviewer inspects source and the whole actual diff. Link builder
evidence for later comparison, not as an expected answer. Model choice alone
does not establish independence. Available context IDs and accepted launch
configuration are observations, not executor attestation or separate credentials;
that enforcement belongs to [#305](https://github.com/haggaikaunda/kami-split/issues/305)
and does not block ordinary trusted delivery.

## Bound retries and hand off

Declare a finite task budget before starting; use the owning pilot budget when
one exists. Allow one focused retry of a failure after identifying a specific
likely cause. If it persists, diagnose with the exact scope/base/head, launch
request and observed error, commands/results, unresolved question, spent/remaining
budget, owner and next action. Do not repeat identical attempts or widen fan-out.

For an unavailable preferred model, record the capability limitation and select
an available authorized model/effort using fresh context. Do not manufacture a
failed launch merely to test fallback. Escalate difficult reasoning to Astra
when available, or retain the available model and explicitly hand off the hard
question. Ask the owner only for an unresolved product/authority/budget decision;
model unavailability is not a routine approval gate. Exhausted budget leaves an
actionable handoff; missing required testing/review/CI never becomes success.

Batch substantive fixes after builder checks and independent testing before final
review where practical. After relevant changes, rerun affected checks and obtain
a whole updated final-diff review. Add roles only for a concrete benefit, avoid
duplicate investigation and concurrent writes to shared resources, and use compact
results and bounded waits. Record routing, fallback/escalation and unknown usage
in the [GitHub stage records](delivery-records.md). Cost per accepted goal is
unknown unless attributable measurements include coordination and failed attempts.
