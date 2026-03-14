---
title: Introduction
description: What is Karajan Code and why use it.
---

**One command. Multiple AI agents. Full quality pipeline.**

Karajan Code (`kj`) orchestrates AI agents like a conductor orchestrates an orchestra. You define **what** needs to happen — code, review, test, secure — and Karajan assigns **who** does each part.

**13 specialized roles.** Triage, researcher, architect, planner, coder, reviewer, tester, security, and more.

**5 AI agents.** Claude, Codex, Gemini, Aider, OpenCode. Mix and match freely.

**Zero extra cost.** Runs on your existing subscriptions — no API keys needed.

---

## The Problem

There are two ways to use AI coding agents today, and both have serious issues:

**Manual usage** — You run an agent, wait for the code, check it yourself, find issues, re-prompt, and repeat. No systematic quality enforcement. Slow. Entirely dependent on your own review skills.

**Automated usage (CI/CD)** — You wire agents into pipelines that run on every push. This removes the manual bottleneck, but introduces **uncontrolled costs**. A single task can burn through tokens indefinitely — agents retrying, reviewers looping, flaky APIs triggering unlimited retries. Real money, no visibility.

**In both cases:** no standard way to enforce quality, control spending, or know when to stop.

## The Solution

<div class="solution-visual">
  <img src="/docs/img/pipeline-animation.gif" alt="Pipeline: 1) Coder writes code and tests (e.g. Claude) → 2) Deterministic guards scan for destructive ops, credential leaks, perf anti-patterns → 3) SonarQube static analysis, optionally complemented by SonarCloud → 4) Reviewer checks for issues (e.g. Codex) → 5) If problems found, coder gets another attempt → 6) Loop until approved or iteration limit reached" loading="lazy" />
</div>

Every session has built-in guardrails: **max iterations**, **per-iteration timeouts**, **total session timeouts**, and optional **estimated budget caps** (in USD or EUR). Fail-fast detection stops the loop early when agents go in circles.

## Key Features

<div class="features-carousel" id="features-carousel">
  <div class="carousel-track">
    <div class="carousel-slide">
      <h3>Role-based Pipeline</h3>
      <p>13 specialized roles — each assignable to any agent. Triage, researcher, architect, planner, coder, refactorer, sonar, reviewer, tester, security, solomon, commiter.</p>
    </div>
    <div class="carousel-slide">
      <h3>5 AI Agents</h3>
      <p>Claude, Codex, Gemini, Aider, OpenCode — mix and match per role. Extensible via plugins in <code>.karajan/plugins/</code>.</p>
    </div>
    <div class="carousel-slide">
      <h3>MCP Server — 18 Tools</h3>
      <p>Use <code>kj</code> from your AI agent. Standalone tools: <code>kj_discover</code>, <code>kj_triage</code>, <code>kj_researcher</code>, <code>kj_architect</code>. Real-time progress notifications.</p>
    </div>
    <div class="carousel-slide">
      <h3>Deterministic Guards</h3>
      <p>Output guard blocks destructive operations and credential leaks. Perf guard catches frontend anti-patterns. Intent classifier pre-triages without LLM cost.</p>
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
.features-carousel {
  position: relative;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid var(--sl-color-gray-5);
  background: var(--sl-color-gray-6);
  margin: 1.5rem 0;
}

.carousel-track {
  display: flex;
  transition: transform 0.4s ease;
}

.carousel-slide {
  min-width: 100%;
  padding: 2rem 2.5rem;
  box-sizing: border-box;
}

.carousel-slide h3 {
  margin: 0 0 0.75rem 0;
  color: var(--sl-color-accent-high);
  font-size: 1.25rem;
}

.carousel-slide p {
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

.solution-visual {
  text-align: center;
  margin: 1.5rem 0;
}

.solution-visual img {
  max-width: 100%;
  border-radius: 12px;
  border: 1px solid var(--sl-color-gray-5);
}
</style>

<script>
document.addEventListener('DOMContentLoaded', () => {
  const carousel = document.getElementById('features-carousel');
  if (!carousel) return;

  const track = carousel.querySelector('.carousel-track');
  const slides = carousel.querySelectorAll('.carousel-slide');
  const dotsContainer = carousel.querySelector('.carousel-dots');
  const prevBtn = carousel.querySelector('.carousel-prev');
  const nextBtn = carousel.querySelector('.carousel-next');

  let current = 0;
  let autoTimer = null;
  const AUTO_INTERVAL = 5000;

  // Create dots
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
    resetAuto();
  }

  function resetAuto() {
    clearInterval(autoTimer);
    autoTimer = setInterval(() => goTo(current + 1), AUTO_INTERVAL);
  }

  prevBtn.addEventListener('click', () => goTo(current - 1));
  nextBtn.addEventListener('click', () => goTo(current + 1));

  // Pause on hover
  carousel.addEventListener('mouseenter', () => clearInterval(autoTimer));
  carousel.addEventListener('mouseleave', resetAuto);

  // Swipe support
  let startX = 0;
  carousel.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  carousel.addEventListener('touchend', (e) => {
    const diff = startX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) goTo(current + (diff > 0 ? 1 : -1));
  }, { passive: true });

  // Keyboard
  carousel.setAttribute('tabindex', '0');
  carousel.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') goTo(current - 1);
    if (e.key === 'ArrowRight') goTo(current + 1);
  });

  resetAuto();
});
</script>

## Quality & Testing

Karajan Code is tested with **1559+ automated tests** across 128 test files, covering every pipeline role, guard, config option, and MCP tool. The test suite runs in under 14 seconds using Vitest.

Quality is enforced at multiple layers:
- **SonarQube** (local, via Docker) — full static analysis with quality gates, blocking on critical issues
- **SonarCloud** (cloud, no Docker needed) — complementary cloud-based analysis, advisory mode by default
- **Deterministic guards** — regex-based checks for destructive operations, credential leaks, and perf anti-patterns
- **TDD enforcement** — source changes require corresponding test changes

Both SonarQube and SonarCloud can run together in the same pipeline — SonarQube as the primary gate and SonarCloud as an additional lens.

## Best with MCP

Karajan Code is designed to be used as an **MCP server** inside your AI agent (Claude, Codex, etc.). The agent sends tasks to `kj_run`, gets real-time progress notifications, and receives structured results — no copy-pasting needed.

## Next Steps

- [Installation](/docs/getting-started/installation/) — Install Karajan Code
- [Quick Start](/docs/getting-started/quick-start/) — Run your first task
