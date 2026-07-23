# kaRAGan — machine install (agent instructions)

Goal: leave this machine FULLY operational for karajan-rag — not a partial
install. Ask before each install; never install silently. The HARD RULE from
[start.md](https://rag.karajancode.com/start.md) applies to every step:
elevated privileges (sudo / Administrator) or no automatic route → STOP,
show the commands, WAIT.

## 1. Install karajan-rag (full product)

Pick the route for THIS machine's operating system:

**Linux / macOS:**

```sh
curl -fsSL https://rag.karajancode.com/install.sh | sh
```

It uses the machine's Node if ≥ 18, or auto-provisions the official Node
LTS into `~/.karajan-rag/node` (checksum-verified, nothing system-wide).
It installs the package AND the default store peer (`@lancedb/lancedb`)
in one shot — without the store, `karajan-rag index` with defaults cannot
run, and a degraded install is a failed install. Review the script first,
as you always should. Equivalent with Node already present:
`npm install -g karajan-rag @lancedb/lancedb`.

**Windows (PowerShell):**

```powershell
irm https://rag.karajancode.com/install.ps1 | iex
```

Same guarantees as the sh installer: machine's Node if ≥ 18, or official
Node LTS zip auto-provisioned into `~\.karajan-rag\node` with checksum
verification. Config via env vars only (`irm | iex` takes no parameters):
`KJR_VERSION`, `KJR_INSTALL_DIR`, `KJR_NO_STORE`.

## 2. Diagnose

Run `karajan-rag doctor` and explain every ✗/⚠ to the user with its fix.
Typical optional pieces and when they matter:

- **`@huggingface/transformers`** — real semantic embeddings (the default
  `hash` embedder is deterministic and dependency-free, fine for trying the
  flow; recommend `transformers` for real corpora). Local, no privileges.
- **Ollama** — the ONLY provider allowed for `confidential` corpora in
  `query --answer` (and the safe default for `internal`). If the user's
  corpus will be confidential and Ollama is missing, installing it needs
  steps outside npm: STOP, point them to <https://ollama.com/download> for
  their OS, WAIT until they confirm.
- **An AI CLI** (claude / codex / gemini) — only needed for `--answer` on
  `public` corpora and for `eval --judges`.

Do not install any of these without asking. Retrieval itself (index +
query) works with zero external dependencies.

## 3. Verify

Run `karajan-rag doctor` again. Done means: the install is complete and you
can tell the user exactly what (if anything) still limits kaRAGan here and
how to lift it.

Then go back to [start.md](https://rag.karajancode.com/start.md) step 2 to
set up the corpus.
