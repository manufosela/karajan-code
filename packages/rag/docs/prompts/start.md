# kaRAGan — start here (agent instructions)

You are an AI agent (Claude Code, Codex, Gemini CLI, Cursor…). Your user wants
a RAG over their code, docs or data using karajan-rag (kaRAGan,
rag.karajancode.com). Route yourself through these steps and report progress
in the user's language.

## 0. HARD RULE — stop and wait

If at ANY point a step needs elevated privileges (sudo on Linux/macOS,
Administrator on Windows) or has no automatic route on this OS: **STOP**.
Show the user the exact commands to run themselves, then **WAIT** until they
say "done". Never time out into "continuing with my own judgment", never
continue with a degraded setup. A partial setup (e.g. an index that cannot
persist because the default store is missing, or a `confidential` corpus
with no local model to answer) is a FAILED setup.

Detect the operating system FIRST — every install route below depends on it.
Never give unix commands to a Windows machine, or PowerShell to unix.

## 1. Is karajan-rag installed on this machine?

Run `karajan-rag --version`.

- **Not installed** → follow
  <https://rag.karajancode.com/install-machine.md> first, then come back to
  step 2.
- **Installed** → continue.

## 2. What state is this directory in?

Check in order:

- **Already a kaRAGan corpus** — `karajan.config.json` with an `easy`
  section exists → nothing to set up. Run `karajan-rag index .` (it is
  incremental: only changes are reprocessed), then ask the user what they
  want: query it, serve it to agents (MCP/HTTP), or evaluate it. The
  reference for every command is
  <https://rag.karajancode.com/rag-project.md> sections 3–6.
- **No config yet** — this directory (or the one the user names) becomes a
  RAG now → follow <https://rag.karajancode.com/rag-project.md> from the
  top. Its first step is a question about data sensitivity that ONLY the
  user can answer — never guess it.

## 3. When setup finishes

Run `karajan-rag doctor`. Report to the user: what got installed or indexed,
anything still limiting kaRAGan on this machine (and the exact way to lift
each limit — e.g. no local model for `confidential` answers), and an example
query they can try right now against their own corpus.

## 4. If you hit a karajan-rag bug or friction

Report it upstream so the maintainer learns about it:
`karajan-rag report-issue --title "<one line>" --command "<what you ran>" --error "<what it said>"`.
It sanitizes paths and PII, checks for open duplicates, and prints a
preview + prefilled URL. Only pass `--publish` (needs the gh CLI) after
your user explicitly confirms they want it published.
