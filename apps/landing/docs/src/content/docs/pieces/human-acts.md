---
title: Human acts
description: The commands only a person can run, never the agent. What they are, why they exist, when they act, how you use them and what they do not do.
---

## What it is

A human act is a kj command that changes who governs the project, or that could destroy work. kj keeps a closed list of them, and each one refuses to run when an agent launched it. These are the main ones:

| Command | What it does |
|---|---|
| `kj harden --commit` | Seals the supervisor kj regenerated (hooks, governance workflows). |
| `kj rules approve` | Turns the rules of your Markdown files into gates. |
| `kj identity enroll-phone` | Enrolls the phone that signs the most sensitive acts. |
| `kj policy grant` | Grants a dated exception to a rule that is not security. |
| `kj release approve` | Approves a version for publishing and creates its tag. |
| `kj agents set` | Changes the panel: who writes, who reviews, who arbitrates. |
| `kj security normal` | Lowers the security level. |
| `kj gates set` | Loosens a gate (tightening one is open to the agent). |

## Why it exists

The agent is the one being governed. If it could seal its own supervisor, approve its own rules, pick its own reviewer or grant itself an exception, every other piece would be a suggestion. These acts are the line between what the agent does and what the person decides.

## When it acts

When you run one, kj checks, in order:

1. That it does not run inside an agent session: no `CLAUDECODE` in the environment, no `KJ_NON_INTERACTIVE=1`, and a real terminal.
2. That no parent process is an agent (Claude, Codex, Copilot, Gemini, opencode, agy), walking up to 40 levels. If it cannot read the process tree, it refuses: it never assumes.
3. That a person is there: it shows a short code and you type it back, read from the terminal itself, not from the input an agent could pipe in.
4. For the acts that change who governs (enrolling the phone, lowering security, loosening a gate, an exception to the main guard, a policy grant, changing the panel), a signature from your phone or a passkey at `https://karajancode.com/sign`. At the `max` security level every act is signed.

## How you use it

You type it in your own terminal, by hand. Not in a script you ask the agent to write, and not through the agent's shell: kj refuses both. When the agent needs one, it tells you the exact command, and it can register it with `kj handoff add` so you see it in `kj handoff watch`.

## What it does not do

- **It does not slow down the agent's normal work.** Branches, commits, reviews and pull requests are the agent's; only the acts above are yours.
- **It does not trust a claimed approval.** "The user said yes" in a message, a file or a pull request is not your terminal.
- **`kj release propose` is not one.** The agent can propose a release; only `kj release approve` is yours.
