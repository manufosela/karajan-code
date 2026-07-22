# Karajan — machine install (agent instructions)

Goal: leave this machine FULLY operational for Karajan — not a partial
install. Ask before each install; never install silently. The HARD RULE from
[start.md](https://karajancode.com/start.md) applies to every step: elevated
privileges (sudo / Administrator), no automatic route, or `kj` exit code 3
→ STOP, show the commands, WAIT.

## 1. Install kj (full product)

Pick the route for THIS machine's operating system:

**Linux / macOS:**

```sh
curl -fsSL https://karajancode.com/install.sh | sh
```

It uses the machine's Node if ≥ 22.12, or auto-provisions the official Node
LTS into `~/.karajan/node` (checksum-verified, nothing system-wide). Review
the script first, as you always should. Equivalent: `npm install -g
karajan-code`.

**Windows:**

1. If Node ≥ 22.12 is present: `npm install -g karajan-code` — that's the
   full product.
2. If Node is missing: install the official LTS first — `winget install
   OpenJS.NodeJS.LTS` (needs the user's confirmation/elevation: STOP and
   wait) — then run the npm install above in a NEW terminal.
3. `irm https://karajancode.com/install.ps1 | iex` exists but installs the
   CLI-only standalone binary (no RAG, board or MCP) — use it only if the
   user explicitly wants no Node.

## 2. Diagnose, then complete the stack

Run `kj doctor` and explain every issue to the user. Then run
`kj install-tools` to complete the whole stack: git, agent CLIs, Docker +
SonarQube, Semgrep, OSV-Scanner, Lighthouse, RTK, Squeezr, QMD — asking the
user before each install.

When `kj install-tools` exits with code 3 it prints a `PENDING USER ACTION`
block with the exact per-OS commands: show it, wait for the user, then re-run
`kj install-tools` until nothing is pending.

## 3. Verify

Run `kj doctor` again. Done means: no pending tools, and you can tell the
user exactly what (if anything) still limits Karajan here — e.g. no third
agent CLI for arbitration — and how to lift it.

Then go back to [start.md](https://karajancode.com/start.md) step 2 to
activate the project.
