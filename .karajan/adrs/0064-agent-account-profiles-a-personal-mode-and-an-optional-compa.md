# Agent account profiles: a personal mode and an optional company mode

Status: proposed
Date: 2026-11-18

## Context

Asked by the maintainer on 2026-11-18. kj launches claude -p and codex exec with whatever login is active on the machine. Most users have one account per provider and want to pace heavy use, with an API key only as a rescue. An operator who works for several clients on one laptop needs each client's work to run on that client's own accounts, so usage stays separate and can be billed, all from the same kj.

## Decision

Proposed: (1) Two modes in the same kj. Personal mode is the default: one profile that every project uses. Company mode is optional and sits on top: named profiles, and each project, or group of projects, is bound to one. (2) A profile names, per provider, the login it uses, each in its own config directory (CLAUDE_CONFIG_DIR for Claude, CODEX_HOME for codex), plus an optional rescue API key. Profiles live under ~/.karajan, never in a repo, and kj never prints a key. (3) The subscription is always the main use. The API key is used only when the profile's rules allow it: when (the subscription limit is reached, or a time window such as the night), with what (which models and roles) and how much (a daily and a monthly budget). (4) Each profile paces its calls: a minimum gap between agent calls, a maximum of calls at once, and a longer wait after a limit message. Pacing respects limits and cost; it does not disguise usage. (5) No mixing: a project only runs on its own profile. If that profile is exhausted and its rules allow no rescue, kj stops and says so; it never borrows another profile. (6) kj records every agent call locally with its project and profile: calls, tokens where the agent reports them, estimated cost, duration and lines. The hu-board gets a page to configure profiles and rules and to show that usage per day, month, year and total, with an export per project and month. (7) The interactive host session is chosen when it is opened, not by kj: where kj can tell which login the session uses, it warns when that login is not the project's.

## Consequences

Each login is set up by hand by its owner, once per profile. Cost on a subscription is an estimate at API prices; only the rescue key has a real cost. kj never rotates accounts to stretch a limit. OpenRouter is not used: it would only cover the API lane and routes the code through a third party; a local gateway can be added later behind the rescue key. Company mode adds nothing to personal mode until a second profile exists.
