# Agent accounts: one list, one or more per project in order of preference

Status: accepted
Date: 2026-11-18

## Context

Asked by the maintainer on 2026-11-18. kj launches claude -p and codex exec with whatever login is active on the machine. Most users have one account per provider and want to pace heavy use, with an API key only as a rescue. An operator who works for several clients on one laptop needs each client's work to run on that client's own accounts, so usage stays separate and can be billed, all from the same kj.

## Decision

Decided by the maintainer on 2026-11-18: (1) No modes. kj keeps one list of accounts and treats them all alike: it never knows whether an account is personal or a company's. (2) An account names its provider, the login it uses in its own config directory (CLAUDE_CONFIG_DIR for Claude, CODEX_HOME for codex) and an optional rescue API key. Accounts live under ~/.karajan, never in a repo, and kj never prints a key. (3) Each project has one or more accounts per provider, in order of preference. A project with none assigned uses the default account. (4) The subscription is always the main use. When a project's account runs out, kj moves to that project's next account, never to another project's. When the project has none left, the rescue API key is used only if its rules allow it: when (the subscription limit is reached, or a time window such as the night), with what (which models and roles) and how much (a daily and a monthly budget). If nothing is left, kj stops and says so. (5) Each account paces its calls: a minimum gap between agent calls, a maximum of calls at once, and a longer wait after a limit message. (6) kj records every agent call locally with its project and account: calls, tokens where the agent reports them, estimated cost, duration and lines. The hu-board gets a page to configure accounts, their order per project and the rescue rules, and to show usage and cost per project and account per day, month, year and total, with an export per project and month for billing. (7) The interactive host session is chosen when it is opened, not by kj: where kj can tell which login the session uses, it warns when that login is not one of the project's.

## Consequences

Each login is set up by hand by its owner, once per account. Cost on a subscription is an estimate at API prices; only the rescue key has a real cost. Moving to a project's next account when one runs out is the maintainer's choice; whether a provider allows it for its accounts is for each account's owner to judge. Order of preference, not an even spread, so every call is billed to a known account. OpenRouter is not used: it would only cover the API lane and routes the code through a third party; a local gateway can be added later behind the rescue key. A user with one account per provider configures nothing.
