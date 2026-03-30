---
title: Introduction
description: What is Karajan Code and why use it.
---

**One command. Multiple AI agents. Full quality pipeline.**

Karajan Code (`kj`) orchestrates AI agents like a conductor orchestrates an orchestra. You define **what** needs to happen — code, review, test, secure — and Karajan assigns **who** does each part.

**15 specialized roles.** Triage, researcher, architect, planner, coder, reviewer, tester, security, and more.

**5 AI agents.** Claude, Codex, Gemini, Aider, OpenCode. Mix and match freely.

**Zero extra cost.** Runs on your existing subscriptions — no API keys needed.

---

## The Problem

There are two ways to use AI coding agents today, and both have serious issues:

**Manual usage** — You run an agent, wait for the code, check it yourself, find issues, re-prompt, and repeat. No systematic quality enforcement. Slow. Entirely dependent on your own review skills.

**Automated usage (CI/CD)** — You wire agents into pipelines that run on every push. This removes the manual bottleneck, but introduces **uncontrolled costs**. A single task can burn through tokens indefinitely — agents retrying, reviewers looping, flaky APIs triggering unlimited retries. Real money, no visibility.

**In both cases:** no standard way to enforce quality, control spending, or know when to stop.

## The Solution

Karajan Code solves both problems by chaining **roles** with **quality gates** and **cost controls**:

<div class="pipeline-carousel" id="pipeline-carousel">
  <div class="pipeline-track">
    <div class="pipeline-slide">
      <div class="pipeline-step-number">1</div>
      <div class="pipeline-step-icon">&#128187;</div>
      <h3>Coder</h3>
      <p>The <strong>coder</strong> role writes code and tests — executed by the AI agent you choose (e.g. Claude, Codex, Gemini).</p>
    </div>
    <div class="pipeline-slide">
      <div class="pipeline-step-number">2</div>
      <div class="pipeline-step-icon">&#128737;</div>
      <h3>Deterministic Guards</h3>
      <p>Regex-based guards scan the diff for <strong>destructive operations</strong>, <strong>credential leaks</strong>, and <strong>performance anti-patterns</strong>. No LLM needed.</p>
    </div>
    <div class="pipeline-slide">
      <div class="pipeline-step-number">3</div>
      <div class="pipeline-step-icon">&#128269;</div>
      <h3>Static Analysis</h3>
      <p><strong>SonarQube</strong> performs full static analysis with quality gates. Optionally complemented by <strong>SonarCloud</strong> for cloud-based advisory analysis.</p>
    </div>
    <div class="pipeline-slide">
      <div class="pipeline-step-number">4</div>
      <div class="pipeline-step-icon">&#128065;</div>
      <h3>Reviewer</h3>
      <p>The <strong>reviewer</strong> role checks the code for issues (e.g. Codex). Scope filter auto-defers out-of-scope items as tech debt.</p>
    </div>
    <div class="pipeline-slide">
      <div class="pipeline-step-number">5</div>
      <div class="pipeline-step-icon">&#128260;</div>
      <h3>Iterate or Approve</h3>
      <p>If problems are found, the <strong>coder gets another attempt</strong>. The loop runs until the code is approved or the iteration limit is reached.</p>
    </div>
    <div class="pipeline-slide">
      <div class="pipeline-step-number">6</div>
      <div class="pipeline-step-icon">&#128170;</div>
      <h3>Built-in Guardrails</h3>
      <p><strong>Max iterations</strong>, <strong>per-iteration timeouts</strong>, <strong>session timeouts</strong>, and <strong>budget caps</strong> (USD/EUR). Fail-fast stops loops early. Full cost reports with <code>kj report --trace</code>.</p>
    </div>
  </div>
  <div class="pipeline-progress">
    <div class="pipeline-progress-bar"></div>
  </div>
  <div class="carousel-controls">
    <button class="carousel-btn carousel-prev" aria-label="Previous">&#8249;</button>
    <div class="carousel-dots" id="pipeline-dots"></div>
    <button class="carousel-btn carousel-next" aria-label="Next">&#8250;</button>
  </div>
</div>

## Key Features

<div class="features-carousel" id="features-carousel">
  <div class="carousel-track">
    <div class="carousel-slide">
      <h3>Role-based Pipeline</h3>
      <p>15 specialized roles — each assignable to any agent. Triage, discover, researcher, architect, planner, coder, refactorer, sonar, reviewer, hu-reviewer, tester, security, audit, solomon, commiter.</p>
    </div>
    <div class="carousel-slide">
      <h3>5 AI Agents</h3>
      <p>Claude, Codex, Gemini, Aider, OpenCode — mix and match per role. Extensible via plugins in <code>.karajan/plugins/</code>.</p>
    </div>
    <div class="carousel-slide">
      <h3>MCP Server — 23 Tools</h3>
      <p>Use <code>kj</code> from your AI agent. Standalone tools: <code>kj_discover</code>, <code>kj_triage</code>, <code>kj_researcher</code>, <code>kj_architect</code>, <code>kj_hu</code>. Real-time progress notifications.</p>
    </div>
    <div class="carousel-slide">
      <h3>Deterministic Guards</h3>
      <p>Output guard blocks destructive operations and credential leaks. Perf guard catches frontend anti-patterns. Intent classifier pre-triages without LLM cost.</p>
    </div>
    <div class="carousel-slide">
      <h3>Injection Guard</h3>
      <p>Prompt injection scanner that protects AI code review from manipulation. Detects directive overrides, invisible Unicode characters, and oversized comment payloads. Also runs as a GitHub Action on every PR.</p>
    </div>
    <div class="carousel-slide">
      <h3>Integrated HU Manager</h3>
      <p>Auto-decomposes complex tasks into formal user stories (HUs). Triage activates hu-reviewer for medium/complex tasks, generating 2-5 HUs with dependencies. Each HU runs its own sub-pipeline (coder→sonar→reviewer) with state tracking. Full PG integration and board visualization.</p>
    </div>
    <div class="carousel-slide">
      <h3>SonarQube + SonarCloud</h3>
      <p>Dual static analysis: SonarQube (local Docker, blocking quality gates) and SonarCloud (cloud, advisory). Both run together in the same pipeline.</p>
    </div>
    <div class="carousel-slide">
      <h3>TDD Enforcement</h3>
      <p>Test changes required when source files change. The pipeline rejects iterations without matching tests.</p>
    </div>
    <div class="carousel-slide">
      <h3>Standalone Role Commands</h3>
      <p><code>kj discover</code>, <code>kj triage</code>, <code>kj researcher</code>, <code>kj architect</code> — run any pre-build role independently from CLI or MCP.</p>
    </div>
    <div class="carousel-slide">
      <h3>Budget Tracking</h3>
      <p>Per-session token counting with estimated API-equivalent costs. Karajan itself adds no cost — it uses your CLI subscriptions.</p>
    </div>
    <div class="carousel-slide">
      <h3>Resilient Run</h3>
      <p>Auto-diagnoses failures and resumes crashed sessions — up to 2 retries. Non-recoverable errors fail immediately. Configurable via <code>session.max_auto_resumes</code>.</p>
    </div>
    <div class="carousel-slide">
      <h3>Git Automation</h3>
      <p>Auto-commit, auto-push, auto-PR after approval. Review profiles: standard, strict, relaxed, paranoid.</p>
    </div>
    <div class="carousel-slide">
      <h3>Smart Session Management</h3>
      <p>Pause/resume with fail-fast detection. Rate limit resilience with auto-fallback. Interactive checkpoints every 5 minutes.</p>
    </div>
    <div class="carousel-slide">
      <h3>Task Decomposition</h3>
      <p>Triage detects when tasks should be split and creates linked subtasks in <a href="https://github.com/manufosela/planning-game-xp">Planning Game</a>.</p>
    </div>
  </div>
  <div class="carousel-controls">
    <button class="carousel-btn carousel-prev" aria-label="Previous">‹</button>
    <div class="carousel-dots"></div>
    <button class="carousel-btn carousel-next" aria-label="Next">›</button>
  </div>
</div>

<style>
/* --- Shared carousel styles --- */
.features-carousel, .pipeline-carousel {
  position: relative;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid var(--sl-color-gray-5);
  background: var(--sl-color-gray-6);
  margin: 1.5rem 0;
}

.carousel-track, .pipeline-track {
  display: flex;
  transition: transform 0.4s ease;
}

.carousel-slide, .pipeline-slide {
  min-width: 100%;
  padding: 2rem 2.5rem;
  box-sizing: border-box;
}

.carousel-slide h3, .pipeline-slide h3 {
  margin: 0 0 0.75rem 0;
  color: var(--sl-color-accent-high);
  font-size: 1.25rem;
}

.carousel-slide p, .pipeline-slide p {
  margin: 0;
  line-height: 1.6;
  color: var(--sl-color-gray-1);
}

.carousel-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 0.75rem 1rem 1.25rem;
}

.carousel-btn {
  background: none;
  border: 1px solid var(--sl-color-gray-4);
  color: var(--sl-color-gray-1);
  font-size: 1.5rem;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.carousel-btn:hover {
  background: var(--sl-color-accent);
  border-color: var(--sl-color-accent);
  color: white;
}

.carousel-dots {
  display: flex;
  gap: 0.4rem;
}

.carousel-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--sl-color-gray-4);
  border: none;
  cursor: pointer;
  padding: 0;
  transition: all 0.2s;
}

.carousel-dot.active {
  background: var(--sl-color-accent);
  transform: scale(1.3);
}

/* --- Pipeline-specific styles --- */
.pipeline-carousel {
  background: linear-gradient(135deg, var(--sl-color-gray-6) 0%, color-mix(in srgb, var(--sl-color-accent-low) 30%, var(--sl-color-gray-6)) 100%);
}

.pipeline-slide {
  text-align: center;
  padding: 2.5rem 2.5rem 1.5rem;
}

.pipeline-step-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: var(--sl-color-accent);
  color: white;
  font-weight: 700;
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
}

.pipeline-step-icon {
  font-size: 2.5rem;
  margin: 0.5rem 0;
  line-height: 1;
}

.pipeline-slide h3 {
  font-size: 1.35rem;
  margin-top: 0.5rem;
}

.pipeline-slide p {
  max-width: 500px;
  margin: 0.5rem auto 0;
  font-size: 0.95rem;
}

.pipeline-progress {
  height: 3px;
  background: var(--sl-color-gray-5);
  margin: 0 2rem;
  border-radius: 2px;
  overflow: hidden;
}

.pipeline-progress-bar {
  height: 100%;
  background: var(--sl-color-accent);
  border-radius: 2px;
  transition: width 0.4s ease;
  width: 16.67%;
}
</style>

<script>
document.addEventListener('DOMContentLoaded', () => {
  function initCarousel(containerId, dotsId, trackSelector, slideSelector, autoInterval) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const track = container.querySelector(trackSelector);
    const slides = container.querySelectorAll(slideSelector);
    const dotsContainer = dotsId ? document.getElementById(dotsId) : container.querySelector('.carousel-dots');
    const prevBtn = container.querySelector('.carousel-prev');
    const nextBtn = container.querySelector('.carousel-next');
    const progressBar = container.querySelector('.pipeline-progress-bar');

    let current = 0;
    let autoTimer = null;

    slides.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.classList.add('carousel-dot');
      dot.setAttribute('aria-label', `Slide ${i + 1}`);
      if (i === 0) dot.classList.add('active');
      dot.addEventListener('click', () => goTo(i));
      dotsContainer.appendChild(dot);
    });

    function goTo(index) {
      current = ((index % slides.length) + slides.length) % slides.length;
      track.style.transform = `translateX(-${current * 100}%)`;
      dotsContainer.querySelectorAll('.carousel-dot').forEach((d, i) => {
        d.classList.toggle('active', i === current);
      });
      if (progressBar) {
        progressBar.style.width = `${((current + 1) / slides.length) * 100}%`;
      }
      resetAuto();
    }

    function resetAuto() {
      clearInterval(autoTimer);
      autoTimer = setInterval(() => goTo(current + 1), autoInterval);
    }

    prevBtn.addEventListener('click', () => goTo(current - 1));
    nextBtn.addEventListener('click', () => goTo(current + 1));

    container.addEventListener('mouseenter', () => clearInterval(autoTimer));
    container.addEventListener('mouseleave', resetAuto);

    let startX = 0;
    container.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
    container.addEventListener('touchend', (e) => {
      const diff = startX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 50) goTo(current + (diff > 0 ? 1 : -1));
    }, { passive: true });

    container.setAttribute('tabindex', '0');
    container.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') goTo(current - 1);
      if (e.key === 'ArrowRight') goTo(current + 1);
    });

    resetAuto();
  }

  initCarousel('pipeline-carousel', 'pipeline-dots', '.pipeline-track', '.pipeline-slide', 4000);
  initCarousel('features-carousel', null, '.carousel-track', '.carousel-slide', 5000);
});
</script>

## Quality & Testing

Karajan Code is tested with **2547 automated tests** across 196 test files, covering every pipeline role, guard, config option, and MCP tool. The test suite runs in under 14 seconds using Vitest.

Quality is enforced at multiple layers:
- **SonarQube** (local, via Docker) — full static analysis with quality gates, blocking on critical issues
- **SonarCloud** (cloud, no Docker needed) — complementary cloud-based analysis, advisory mode by default
- **Deterministic guards** — regex-based checks for destructive operations, credential leaks, and perf anti-patterns
- **TDD enforcement** — source changes require corresponding test changes

Both SonarQube and SonarCloud can run together in the same pipeline — SonarQube as the primary gate and SonarCloud as an additional lens.

## Two Modes

Karajan offers two ways to work:

**Skills mode** — 8 slash commands (`/kj-code`, `/kj-review`, `/kj-run`, etc.) installed directly in Claude Code. Each command includes built-in guardrails. No MCP server needed — ideal for single-agent workflows. Install with `kj init`.

**Orchestrator mode** — Full MCP server with 23 tools. Multi-agent pipeline with subprocess orchestration, session management, budget tracking, and rate-limit resilience. Ideal for complex tasks and CI/CD integration.

Both modes can coexist. Use skills for quick tasks and the orchestrator when you need multiple agents or full pipeline control. See the [Skills Guide](/docs/guides/skills/) for details.

## Next Steps

- [Installation](/docs/getting-started/installation/) — Install Karajan Code
- [Quick Start](/docs/getting-started/quick-start/) — Run your first task
- [Skills Mode](/docs/guides/skills/) — Use as slash commands
