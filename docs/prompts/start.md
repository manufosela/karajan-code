# Karajan — start here (agent instructions)

You are an AI agent (Claude Code, Codex, Gemini CLI, Cursor…). Your user wants
to use Karajan Code (`kj`, karajancode.com) in the current project. Route
yourself through these steps and report progress in the user's language.

## 0. HARD RULE — stop and wait

If at ANY point a step needs sudo, has no automatic route on this OS, or any
`kj` command exits with code 3 (`PENDING USER ACTION`): **STOP**. Show the
user the exact commands to run themselves, then **WAIT** until they say
"done". Never time out into "continuing with my own judgment", never continue
with a degraded setup. A partial setup (e.g. an empty RAG because
Docker/Ollama is missing) is a FAILED setup.

## 1. Is kj installed on this machine?

Run `kj --version`.

- **Not installed** → follow <https://karajancode.com/install-machine.md>
  first, then come back to step 2.
- **Installed** → continue.

## 2. What kind of project is this directory?

Check in order:

- **Already active** — `.karajan/review-gate` exists, or the rules file
  (CLAUDE.md / AGENTS.md / GEMINI.md) contains a "Karajan method (v4)" block
  → nothing to set up. Read the block, follow the method from now on, and ask
  the user what to work on next. You are done here.
- **New / empty** — no meaningful codebase yet
  → follow <https://karajancode.com/project-new.md>
- **Existing codebase** to keep developing, now with Karajan
  → follow <https://karajancode.com/project-legacy.md>

## 3. When setup finishes

Run `kj doctor`. Report to the user: what got installed or activated, anything
still limiting Karajan on this machine (and the exact way to lift each limit),
and the first thing they can ask you to build. From now on you operate under
the "Karajan method (v4)" block in this project's rules file: RAG before
assuming, card first, tests first, cross-AI review before every commit.
