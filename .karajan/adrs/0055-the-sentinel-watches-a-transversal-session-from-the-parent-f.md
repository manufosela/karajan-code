# The Sentinel watches a transversal session from the parent folder

Status: accepted
Date: 2026-11-12
Accepted: 2026-11-12, by the maintainer

## Context

A Claude session opened in a parent folder that is not a repo, marked with .claude-transversal (the maintainer authorized it on 2026-11-08), mutates the child repos. The Sentinel is installed in the Claude settings of each repo, so a session whose cwd is the parent loads none of it. Observed on 2026-11-12 in ws_tribbu/v2: no tool call was judged, a commit of supervisor hooks went through, and kj review --staged refused with no session activity recorded, because the RAG ledger is written by the hook.

## Decision

Decided by the maintainer on 2026-11-12: kj installs the Sentinel in the transversal parent folder too. Each tool call is resolved to the child repo it touches, judged with that repo policy, supervisor and lane rules, and recorded in that repo ledger, as if the session were opened inside it. A call that touches no child repo, or more than one, is refused. A parent folder without .claude-transversal gets nothing. Rejected: one session per repo (it drops a way of working the maintainer authorized) and a warning only (the session would stay unwatched).

## Consequences

One more install target for kj harden and kj doctor, with its own uninstall. Every guard must take the repo from the call path, not from cwd. Removing the .claude-transversal marker revokes the parent install.
