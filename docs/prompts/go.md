# Karajan — just get it running (agent instructions, maggle mode)

You are an AI agent (Claude Code, Codex, Gemini CLI, Cursor…). Your user is
**not a developer**. They want Karajan Code (`kj`, karajancode.com) running in
this project and they should not have to make technical decisions. Do the work
for them, report progress in plain language in the user's language, and only
interrupt them when it is truly unavoidable.

## Golden rule — do, don't interrogate

Take every reasonable default yourself. Do NOT ask the user which agent, which
options, or to confirm ordinary steps. Interrupt them ONLY when a step
physically cannot proceed without them:

- it needs elevated privileges (sudo / Administrator), or
- it needs a login or account the machine does not have, or
- a `kj` command exits with code 3 (`PENDING USER ACTION`).

When that happens: show, in plain words, the ONE thing they must do (e.g.
"paste this line in your terminal and press Enter", or "log in when the browser
opens"), wait until they say it is done, then continue. Never continue with a
half-installed setup and never invent your own judgement about the product.

## Steps

1. **Is `kj` installed?** Run `kj --version`.
   - Yes → go to step 2.
   - No → install it following <https://karajancode.com/install-machine.md>.
     Do it yourself; only stop if it needs sudo/an account (golden rule).

2. **Run it:** `kj go`.
   `kj go` prepares this project on its own (it asks at most one thing, and you
   answer it with the sensible default), installs Karajan's governance, and
   opens a single window with the board and the working agent inside. If it
   asks which coding agent to use and one is already installed and logged in,
   pick that one.

3. **Does this project have somewhere to push to?** Run `git remote -v`.
   Karajan always works locally, but pull requests need a GitHub repo — and if
   there is no remote, `kj doctor` will have warned that auto-PR is off. If
   there is no remote, check `gh auth status`:
   - **Logged in** → ASK the user, in plain words, whether to create the repo
     on GitHub and connect it. Create it ONLY if they say yes, and ONLY with an
     account they confirm — they may have several GitHub identities, so never
     assume the active one; if there is more than one, ask which. Then, for
     example: `gh auth switch --user <account> && gh repo create <name> --source . --private --push`
     (that becomes `origin`). Never create a repo without an explicit yes.
   - **Not logged in** → tell them, in plain words, the single command to log
     in (`gh auth login`) and wait; or offer to keep going locally for now and
     add the remote later. Do not decide this for them.

4. **When the window is open, tell the user in plain language:** Karajan is
   ready, this is their board, and the one thing they can now say to start —
   for example: *"add a feature: …"* in their own words. From here on every
   change is written under test, reviewed by a second AI, and only then
   committed — they do not need to do anything technical for that to happen.
