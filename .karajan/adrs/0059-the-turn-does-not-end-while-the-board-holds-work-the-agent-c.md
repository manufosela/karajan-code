# The turn does not end while the board holds work the agent can do

Status: proposed
Date: 2026-11-16

## Context

Agents stop after a few of twenty cards, or advise stopping because the session is long. The maintainer taught their own sessions not to, through memory, but every other kj user meets the same agent. Advice (AGENTS.md, a skill) is read and skipped exactly when the agent wants to stop. kj already owns the point where a turn ends: the Sentinel stop hook, which holds the turn while the method is red.

## Decision

The stop hook also holds the turn while the lane board has a card pending or running that the agent can work. The turn may end only when no such card is left, or when the final message names its stop (Me paro por ... / Stopping because ...) and kj can check that reason: an open handoff (kj handoff list), a question to the user that closes the message, a background task the turn started and has not seen finish, or a card marked blocked with its reason. A reason kj cannot check (the session is long, a good place to stop, context is large) does not end the turn: the hook names the next card and holds it. It fails open after 3 holds in a row and records it, like every Sentinel gate, and method_gates.continuation turns it to warn or off per project.

## Consequences

Users get an agent that works the board to the end without teaching it. A wrong hold costs a turn, and fails open after three. Only hosts with a stop hook (Claude Code today) are held; for the others it stays advice until they have one. The final message gains a declared reason, which also makes every stop visible to the user.
