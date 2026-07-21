# Karajan — machine install (agent instructions)

Goal: leave this machine FULLY operational for Karajan — not a partial
install. Ask before each install; never install silently. The HARD RULE from
[start.md](https://karajancode.com/start.md) applies to every step: sudo, no
automatic route, or `kj` exit code 3 → STOP, show the commands, WAIT.

## 1. Install kj (full product)

```sh
curl -fsSL https://karajancode.com/install.sh | sh
```

It uses the machine's Node if ≥ 22.12, or auto-provisions the official Node
LTS into `~/.karajan/node` (checksum-verified, nothing system-wide). Review
the script first, as you always should. Equivalent: `npm install -g
karajan-code`.

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
