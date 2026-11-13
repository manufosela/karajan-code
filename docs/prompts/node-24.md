# Karajan: move this machine to Node 24 (agent instructions)

You are an AI agent (Claude Code, Codex, Gemini CLI, Cursor…). Your user wants this machine on
Node 24 with Karajan Code (`kj`) still working afterwards. Node 22 keeps working with kj today, but
its support ends in April 2027 and kj 6.0 will require Node 24. Do the work, report in plain words in
the user's language, and stop only when a step needs them.

## Golden rule

Ask before each install and never install silently. STOP and show the exact command, then wait, when
a step needs elevated privileges (sudo / Administrator), a login, or a `kj` command exits with code 3
(`PENDING USER ACTION`). Never leave the machine half moved: if a step fails, say which, and how to
go back (the old Node stays installed until the end).

## 1. See where things stand

Run, and keep the answers:

- `node --version` (the current major, for example `v22.23.4` is 22);
- `command -v node` (Windows: `where node`), which tells how Node was installed;
- `kj --version`, and `npm ls -g --depth=0` (the global packages to carry over).

If Node is already 24 or newer, tell the user, run `kj doctor`, and stop: nothing to do.

## 2. Install Node 24 with the tool that already manages Node

Pick by the path of `node`:

| Path contains | Tool | Install and select 24 |
|---|---|---|
| `.nvm/` | nvm | `nvm install 24 --reinstall-packages-from=current`, then `nvm alias default 24` |
| `fnm` | fnm | `fnm install 24`, `fnm default 24`, `fnm use 24` |
| `.volta/` | Volta | `volta install node@24` |
| `.karajan/node` | Karajan's own Node | re-run the installer from <https://karajancode.com/install-machine.md>; it provisions the current LTS |
| `homebrew` or `/opt/homebrew` | Homebrew | `brew install node@24`, then `brew link --overwrite node@24` |
| `/usr/bin` (Linux) | system package | install Node 24 from the distribution's NodeSource or official package (needs sudo: golden rule) |
| Windows, and `nvm version` answers | nvm-windows (its Node also shows under `Program Files\nodejs`) | `nvm install 24`, `nvm use 24` (may need Administrator) |
| Windows, `Program Files\nodejs`, no `nvm` | Windows installer | the user runs the Node 24 installer from <https://nodejs.org/en/download> (pick version 24); a package manager's "LTS" may not be 24 |

On Windows, check `nvm version` first: nvm-windows links its active Node into `Program Files\nodejs`,
so the path alone does not tell it apart from the installer.

With nvm, `--reinstall-packages-from=current` already carries the global packages over. With any
other tool, reinstall each global package from step 1 under Node 24 with `npm install -g <name>`.

## 3. Karajan under Node 24

- Open a new terminal (or reload the shell) and check that `node --version` says `v24`. If it says
  anything else, the move did not happen: stop and tell the user what the tool installed.
- `kj --version`. If it is not found, reinstall it: `npm install -g karajan-code` (or the route in
  <https://karajancode.com/install-machine.md> if kj was installed as a binary).
- `kj doctor`. Everything it marks as failed after the move is part of this task: fix it or tell
  the user the one thing they must do.

## 4. Report

Tell the user, in plain words: the Node version before and after, what was carried over, that
`kj doctor` is green (or what is left and who does it), and that the old Node is still installed and
can be removed later if they want (say how with their tool; do not remove it yourself).
