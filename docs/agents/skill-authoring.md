# Authoring repository skills

Start with [author-repository-skill](../../.agents/skills/author-repository-skill/SKILL.md).
It supplements the installed `skill-creator` when available; it neither shadows
that skill nor installs third-party skills. The [delivery workflow](delivery-workflow.md)
still owns issue → PR → independent testing → whole-final-diff review → final CI
→ authorized merge → closeout.

## Choose the smallest useful artifact

Use a skill for a recurring, non-obvious procedure with a clear trigger and
observable outcome. Use maintained guidance for knowledge, a test for a regression,
and a small helper for repeated deterministic work. A one-off successful run is
issue/PR evidence. Improve an existing workflow before adding an overlapping skill.
Do not turn all docs into skills or add planner/reviewer layers without a concrete
benefit. Existing authority carries through authorized stages; skills never grant
new authority or require routine reconfirmation.

## Author and validate

1. Read the approved goal, existing skills, canonical workflow and relevant code.
   Record why a skill is needed and its maintenance owner on the tracking issue.
2. Before tuning, declare a finite evaluation budget, comparable baseline inputs,
   positive and meaningful negative cases, activation/non-activation cases and
   an independent held-out case. Include already-covered work and one-off reports
   when evaluating an authoring skill. Define the acceptable overhead and the
   conditions for adopt, revise or defer. Keep actual trials on GitHub.
3. Copy the [non-live template](../../.agents/skills/author-repository-skill/assets/skill-template.md)
   into `.agents/skills/<name>/SKILL.md`. Adapt it; do not keep empty headings or
   placeholders. See the [filled and unsafe examples](skill-examples.md).
4. Keep the main procedure short. Link authoritative guides rather than duplicate
   their policy; use relative Markdown links for local resources. State inputs,
   prerequisites, side effects/authority, observable evidence, bounded retries,
   and partial-completion/resumption behavior. A requested assessment stays
   read-only; a delivery request includes its already authorized later stages.
5. Run the validation commands below. Inspect each link and current-state claim
   against actual source. Format validation is not behavioral evaluation.
6. Exercise the same baseline inputs with the skill, then let an independent
   context try a held-out case from raw inputs without author-provided answers.
   Use disposable fixtures for mutations; never inject failures in production.
   Record actual settings, attempts, corrections, limitations and elapsed
   coordination/recording overhead. Missing usage/cost remains unknown.
7. Obtain the normal independent tester and final reviewer. Publish an adoption
   decision on the issue, revise or defer unhelpful instructions, and link any
   unresolved follow-up. Maintenance changes repeat affected cases and check
   whether linked contracts or runtime capabilities changed.

## Portable format and local runtime

The [Agent Skills specification](https://agentskills.io/specification) defines
`SKILL.md`, YAML frontmatter (`name`, `description`), folder/name matching and
optional resources. Kami uses lowercase ASCII hyphenated names for portability,
relative inline Markdown links and a nonempty procedure. These are local choices,
not additional universal Agent Skills fields. Metadata is descriptive, not proof
of execution or authorization. Avoid credentials and personal data in examples.

[Codex discovery](https://developers.openai.com/codex/skills) reads `.agents/skills`
along the repository path; the runtime exposes names/descriptions and loads
instructions when applicable. Keep automatic discovery enabled. Optional vendor
UI/invocation metadata is separate from portable frontmatter and is not a
permission boundary. Do not change global user settings. If a running session
does not discover a newly added skill, report that limitation, read it explicitly
for the current task and refresh the session when practical; do not claim implicit
activation was tested. Other runtimes must confirm their own discovery behavior.

## Objective checks from a fresh checkout

Python 3.11+, Git and network access are needed once to install the pinned
[upstream reference validator](https://github.com/agentskills/agentskills/tree/69ef37e9424c0a7ea9dd2293b559e43ec8176379/skills-ref)
in an ignored environment. No global packages are changed:

```sh
python3 -m venv .tools/skills-validator
.tools/skills-validator/bin/python -m pip install -r scripts/agents/requirements.txt
.tools/skills-validator/bin/python scripts/agents/check_skills.py
.tools/skills-validator/bin/python -m unittest discover -s scripts/agents -p '*_test.py'
```

The upstream validator owns portable frontmatter checks; the small local wrapper
checks ASCII names, string metadata, nonempty body, contained resources and local
inline Markdown file links in live skills and their Markdown resources. It checks
file existence, not heading anchors or network freshness. Manual inspection owns
those, plus trigger precision, safety and usefulness. Templates/examples are
non-live assets, not extra installed skills. Tests exercise invalid input and
filesystem boundaries; they do not enforce subjective wording or line counts.

The repository CI job runs these checks. Updating the upstream pin/dependencies
requires reviewing upstream changes and rerunning malformed-input fixtures and
affected behavioral cases. Keep sources and runtime assumptions here current;
record the particular verification date/results on the PR.
