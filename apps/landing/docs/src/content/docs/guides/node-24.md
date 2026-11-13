---
title: Move to Node 24
description: Why Karajan recommends Node 24, what changes and when, and the prompt that moves your machine for you.
---

Karajan works on Node 22 and on Node 24. Node 22's support ends in April 2027, so Karajan recommends Node 24 from now on: `kj doctor` says so, and any `kj` command reminds you once a day while you are on an older Node.

## What happens and when

- **Now (5.x)**: nothing breaks. kj runs on Node 22.12 and newer, and CI tests every change on Node 22 and on Node 24.
- **Later, in kj 6.0**: Node 24 becomes the minimum. The date will be announced in advance, and it will be before Node 22's support ends.

## Let your agent do it

Paste this into your agent (Claude Code, Codex, Cursor, VS Code):

```text
Move me to Node 24 and keep Karajan working: read karajancode.com/node-24.md and do everything it says.
```

The agent finds out how Node is installed on your machine (nvm, fnm, Volta, Homebrew, the system package, Windows, or the Node Karajan provisions itself), installs Node 24 with that same tool, carries your global npm packages over, reinstalls kj if it went missing, and runs `kj doctor`. It asks before each install and stops when a step needs you (sudo, Administrator, a login). The old Node stays installed; it tells you how to remove it if you want to.

## By hand, with nvm

```sh
nvm install 24 --reinstall-packages-from=current
nvm alias default 24
```

Open a new terminal, then:

```sh
node --version   # v24.x
kj --version
kj doctor
```

With nvm each Node version has its own global packages; `--reinstall-packages-from=current` carries them over, kj included. With another tool, reinstall kj with `npm install -g karajan-code` after the move.
