# Why I built a local multi-agent coding orchestrator

*Published on DEV.to — tags: javascript, ai, mcp, opensource*

---

I've been using AI for development for three years. I've gone through every phase — probably the same ones you have.

I started using it as glorified autocomplete. Then accepting whole functions. Then entire classes. Then through prompts, asking it to build things. With all the frustration that entails: it ignores instructions, changes things you didn't ask for, invents features, hallucinates APIs that don't exist... nothing you haven't experienced, I'm sure ;)

But gradually, alongside real improvements in the models, I started seeing that I was getting closer to being able to build complete applications without writing a single line of code. Just reviewing, correcting, directing. The dream was to automate it — autonomously and with guarantees.

The problem is that with a CLI or an IDE, you always need to interact. Always. Someone has to be at the wheel. When I tried solving that with APIs for more programmatic control, I hit the other problem: costs. A night of agents running in loops can get expensive. Very expensive. Without warning.

With CLIs, on the other hand, Claude tells you at some point: "you can't use me again until tomorrow at 7:00am". On one hand you're annoyed because it left you mid-task. On the other you think, well, I'll call it a day. And best of all: no credit card surprises. The limit is the limit, and you control it.

That was the key. Don't call APIs. Orchestrate CLIs. Predictable cost, real autonomy, no need to babysit.

That's how Karajan Code was born.

## The problem I wanted to solve — the one nobody else solved the same way

An orchestrated pipeline that runs autonomously, with quality guarantees, without variable costs, without me having to be there. That's what I wanted. Analyze requirements, write tests first, implement, run SonarQube, review the code, iterate. All without manual supervision.

Claude Code is great for interactive work. I use it. But it's a conversation, not a process. Every execution depends on that session's context. What I wanted was more like a CI/CD pipeline: define it once, trust it, and have it run the same way every time.

## Why "Karajan"

Herbert von Karajan conducted the Berlin Philharmonic for 35 years. His philosophy was that a great orchestra isn't one conductor controlling many musicians — it's many excellent musicians who know exactly when to play and when to listen, coordinated by someone who understands the whole.

That's what I wanted for AI agents. Not one model doing everything. Multiple specialized agents, each excellent at their role, coordinated by an orchestrator that understands the pipeline.

By the way, there's another project called karajan, created by Wooga (a mobile gaming company) as an orchestrator for data aggregations on Apache Airflow. Same musical inspiration, completely different purpose. Good name for orchestration, apparently.

## The architecture: roles as markdown files

The core idea behind Karajan is that agent behavior should be declarative and file-based, not hardcoded. I saw this pattern used in different contexts and tools, and wanted to apply it here from the start.

Every role in the pipeline is defined by a markdown file — a plain document that describes what the agent should do, what to check, and what good output looks like:

```
.karajan/roles/         # Your project-specific overrides
~/.karajan/roles/       # Your global overrides
templates/roles/        # System defaults (shipped with the package)
```

There are currently 15 roles in the pipeline, each handling a specific concern:

```
hu-reviewer? → triage → discover? → architect? → planner? → coder → sonar? → impeccable? → reviewer → tester? → security? → solomon → audit → commiter?
```

You can override any built-in role or create new ones. No code required. The agents read the role files and adapt their behavior. You can encode your team's conventions, your domain rules, your quality standards — and every run of Karajan will apply them automatically.

The project's hexagonal architecture was influenced by the work of [Jorge del Casar](https://twitter.com/jorgecasar), after seeing an orchestrator he had with clean layer separation.

## TDD and the full pipeline

The pipeline enforces tests first. The coder doesn't just write code: its prompt includes writing tests before implementation. TDD integrated into the role, not as an external layer.

Then the flow continues:

1. **Coder** writes tests and code (TDD within the role itself)
2. **Sonar** analyzes static quality
3. **Reviewer** reviews the code; if there's conflict with the coder, Solomon intervenes
4. **Tester** verifies coverage, test quality, that tests cover use cases and acceptance criteria
5. **Security** audits according to OWASP
6. **Audit** certifies the final result — if it finds critical issues, sends the coder back to fix

Karajan auto-detects your test framework (vitest, jest, mocha, playwright). No additional configuration needed.

The reasoning is simple: tests written after implementation are tests written to pass the code that already exists. Tests written before describe what the code should do. Those are fundamentally different things.

## Solomon: the arbiter

Solomon isn't simply a supervisor that evaluates rejections. It's the pipeline's arbiter when there's conflict between roles.

Each role has its rules and its purpose, and sometimes that creates a deadlock. A real example: the coder hardcodes something because it knows a later task will refactor it (conscious, controlled technical debt). The reviewer, following its rules, can't approve that hardcoding. Neither yields because each one is doing their job correctly. Without an arbiter, the loop never ends.

Solomon listens to both sides, evaluates the context, and decides who yields and on what. The reviewer isn't always right, nor is the coder. It depends on the case.

And it's not just for coder-reviewer conflicts. Any role that encounters a dilemma its rules can't resolve has access to Solomon. Only when Solomon itself finds a problem where any solution could cause another does it use its wildcard: human interaction. That's the only moment Karajan interrupts you to ask you to decide.

It's the difference between an AI pipeline that runs and one that actually converges.

## Multi-provider routing

Karajan supports 5 AI agents: Claude, Codex, Gemini, Aider, and OpenCode. Each with its own CLI. You configure which agent handles which role:

```yaml
# kj.config.yml
coder: claude
reviewer: codex
solomon: gemini
```

By default, if you have Claude, Codex, and Gemini available, it uses them as: Claude for coder, Codex for reviewer, Gemini for Solomon. If you don't have all of them, Claude or Codex covers everything. You decide based on what you have installed and activated.

And if you want another agent, there's a plugin system to easily add any other.

## No surprise costs. Ever.

This is the most important technical decision in the project and what differentiates Karajan from any other orchestrator the most.

Most multi-agent tools call AI APIs directly. Every agent invocation costs tokens. A complex pipeline running overnight — planner, coder, reviewer, tester, SonarQube loop — can generate a bill you didn't expect.

Karajan doesn't call APIs. It drives AI CLIs: Claude Code CLI, Codex CLI, Gemini CLI — the same tools you use interactively from the terminal. Those CLIs operate within your subscription's usage limits. When one hits the cap, it stops. It tells you when it can continue. And Karajan waits, saves the pipeline state, and resumes from the last completed step when the limit resets.

No lost work. No starting from scratch. No bill surprises. The cost of Karajan is exactly the cost of your subscriptions. Nothing more.

## MCP and token savings with RTK

Karajan is built on the Model Context Protocol. It exposes 20 MCP tools, which means you can use it from inside Claude Code, Codex, or any MCP-compatible host:

```bash
# From inside Claude Code:
kj_run({ task: "Fix the SQL injection in search endpoint" })
```

The AI agent sends tasks to Karajan, receives real-time progress notifications, and gets structured results. No copy-pasting. No context switching.

Additionally, Karajan integrates with [RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) to reduce token consumption by 60-90% on every Bash command agents execute. If RTK is installed, Karajan auto-detects it and instructs agents to use it. On long pipelines, the savings are considerable.

Karajan also works standalone from the terminal:

```bash
kj run "Create a utility function that validates Spanish DNI numbers, with tests"
```

## Initial setup

A principle I pursued from the start: if something can be auto-detected, it should be. But I'll be honest: you need to run `kj init` to get started. It's minimal configuration, and if you have everything installed you'll sort it in a minute. If you don't have the CLIs installed or configured, you'll need to do that.

What does auto-detect without additional configuration:

- Which test framework you use, to enable TDD
- Whether SonarQube is running, starts Docker if needed
- Task complexity, simplifies the pipeline for trivial tasks
- Provider outages (500 errors), retries with backoff instead of failing

## Why vanilla JavaScript

Every time I mention this, someone asks if I plan to migrate to TypeScript.

No.

TypeScript was invented by Java programmers who don't understand JavaScript and want to turn it into something else. It was born that way. It's designed for those who need strong types because they come from languages where that's mandatory, and don't know how to work any other way.

I've been with JavaScript my whole career. I know what I'm doing. I use JSDoc and `.d.ts` files and my IDE warns me perfectly well if I mess up. I have full control. My code reads the same in development as in production if you don't minify it, because it's the same language. And if I feel like using `==` at a specific moment and I know exactly why, I do it. TypeScript would prevent that.

Nobody has shown me that using TypeScript (learning interfaces, naming conventions, and `<TYPE>` syntax) is more efficient or safer than well-written JS. For someone who knows JS, that is. For someone coming from Java or C#, I understand TypeScript feels more comfortable. Respect. But that's not my case, and I'm not going to change because it's trendy.

Karajan has 1,847 tests across 149 files. CI green on Node 20 and 22. That's the type safety.

I know it's an unpopular opinion. If you don't like it, learn JS or look away :P

## Karajan developed by Karajan

52 releases in 23 days. Many people see that number and think it's chaotic. It isn't, and there's a specific reason: as the project gained traction and I had the first roles working, I started developing Karajan with Karajan itself. The orchestrator building itself.

I had to fix things manually, of course. But that accelerated iteration, with the system itself as the development tool, is what allowed discovering improvements and new roles organically. Each release adds something specific, documented in the changelog. The speed is possible because the foundation is solid: vanilla JS with good test coverage lets you move fast without fear.

## Current state

Karajan works. I use it. It has things to improve, like any project in active development, and it can hang on particularly complex tasks. But it's not unstable: it's software in constant evolution that does what it says it does.

At the time of publishing this article, Karajan is at **version 1.32.1**.

```bash
npm install -g karajan-code
kj init
kj run "Your task here"
```

52 versions published, 1,847 tests, CI green on Node 20 and 22.

**What's in the latest version:**

- 15 pipeline roles (including HU Reviewer for user story certification)
- 5 AI agents supported
- 20 MCP tools
- Automatic RTK integration for token savings
- Solomon supervisor resolving conflicts between roles
- Mandatory audit post-approval — certifies code before completion
- Auto-detection of test framework, automatic SonarQube management, pipeline simplification by complexity
- `kj audit` for read-only codebase health analysis
- Provider outage resilience (retry with backoff on 500/5xx)
- Quiet mode by default — clean output without stream-json noise

If you build something with it, or if something doesn't work as documented, [open an issue](https://github.com/manufosela/karajan-code/issues). That's the most useful thing you can do right now.

---

**[@manufosela](https://github.com/manufosela)** is Head of Engineering at Geniova Technologies, co-organizer of [NodeJS Madrid](https://www.meetup.com/node-js-madrid/), and author of *Liderazgo Afectivo* ([ES — Savvily](https://savvily.es/libros/liderazgo-afectivo/) | [EN — Amazon](https://www.amazon.com/dp/B0D7F4C8KC)). He has published 90+ npm packages.

Inspirations and thanks: [Jorge del Casar](https://twitter.com/jorgecasar) (hexagonal architecture), [Joan León](https://twitter.com/nucliweb) (WebPerf Snippets, inspiration for the frontend performance quality gate).

[Karajan Code on GitHub](https://github.com/manufosela/karajan-code) · [karajancode.com](https://karajancode.com) · [npm](https://www.npmjs.com/package/karajan-code)
