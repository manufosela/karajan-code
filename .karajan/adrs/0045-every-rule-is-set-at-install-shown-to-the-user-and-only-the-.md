# Every rule is set at install, shown to the user, and only the adjustable ones change

Status: proposed
Date: 2026-11-02

## Context

Debated with the maintainer on 2026-11-02. The rules live today in method_gates of kj.config.yml, hidden from a user who must not edit YAML; the method block hardcodes values (150/200 lines) that a project or a skill may change; a project whose CONTRIBUTING.md asks for another commit style cannot follow Conventional Commits.

## Decision

kj init asks nothing: it applies every rule and tells the user how to change the adjustable ones. FIXED rules (card before code and never commit on the base branch; review by a different AI bound to the exact diff; security findings never arbitrable, with the security audit before review on sensitive surface; no AI attribution; privacy scan before publishing) change for no one; when a project contradicts one, kj init says so and the user decides whether to use Karajan there. ADJUSTABLE rules (PR size, tests with code, the project commit convention, dependency cooldown, mutation, card skills, claims) take their value in this order: what the project says (its commitlint config, PR template and git history, detected without a model; the prose of CONTRIBUTING.md read by the agent, each setting stored with the exact sentence that justifies it and rejected when that sentence is not in the file), else the kj defaults. Skills may only tighten an adjustable rule, never loosen it, never touch a fixed one; loosening is the user alone. kj gates lists every rule with its value and who set it (default, project, user, skill), and changes an adjustable one when the user asks (in words to the agent, or typed); the same list is shown at the end of kj init, in kj doctor and in the governance tab of the HU Board, which can change an adjustable rule with a click. The method block the agents read is generated with the live values; the rulesync copy is written only when the project uses rulesync.

## Consequences

One registry of rules with a value resolver and an origin per value; every gate reads its value from it instead of its own config key; skills need a way to declare a tightening in their metadata (atril format, to agree with its maintainer); the method block is re-rendered on every change.
