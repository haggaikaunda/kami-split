# Agent documentation

Start with the repository [agent instructions](../../AGENTS.md) and [delivery workflow](delivery-workflow.md). GitHub issues define approved scope; independent testing and final-diff review remain required.

- [Role prompts](prompts/builder.md): [builder](prompts/builder.md), [tester](prompts/tester.md), and [reviewer](prompts/reviewer.md).
- [Web instructions](../../apps/web/AGENTS.md): Next.js conventions and browser verification.
- [Go API instructions](../../apps/api/AGENTS.md): concise requirements for future backend work.
- [Go engineering guide](go-guidelines.md): rationale, selected external conventions, and verification expectations.
- [Application documentation](../application/README.md): current behavior and planned architecture.

The existing web application and its test suite remain the implementation baseline. The Go API implements verified identity, authorized persisted expenses and complete balances, plus internal targeted invitation/admission/delivery recovery. Targeted onboarding connects the real Auth/email/browser entry journey; the [Relay expense journey](../application/relay-expenses.md) connects admitted groups, expenses and complete balances.
