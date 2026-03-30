---
title: Introducción
description: Qué es Karajan Code y por qué usarlo.
---

**Un comando. Múltiples agentes IA. Pipeline de calidad completo.**

Karajan Code (`kj`) orquesta agentes de IA como un director de orquesta dirige una sinfonía. Tú defines **qué** tiene que pasar — codificar, revisar, testear, securizar — y Karajan asigna **quién** hace cada parte.

**15 roles especializados.** Triage, researcher, architect, planner, coder, reviewer, tester, security, y más.

**5 agentes IA.** Claude, Codex, Gemini, Aider, OpenCode. Combínalos libremente.

**Sin coste adicional.** Funciona con tus suscripciones existentes — no necesitas API keys.

---

## El Problema

Hoy hay dos formas de usar agentes de IA para programar, y ambas tienen problemas serios:

**Uso manual** — Ejecutas un agente, esperas el código, lo revisas tú mismo, encuentras problemas, vuelves a hacer prompt y repites. Sin control de calidad sistemático. Lento. Depende enteramente de tu capacidad de revisión.

**Uso automatizado (CI/CD)** — Conectas agentes a pipelines que se ejecutan en cada push. Eliminas el cuello de botella manual, pero introduces **costes sin control**. Una sola tarea puede quemar tokens indefinidamente — agentes reintentando, reviewers en bucle, APIs inestables disparando reintentos ilimitados. Dinero real, sin visibilidad.

**En ambos casos:** no hay forma estándar de asegurar calidad, controlar el gasto, o saber cuándo parar.

## La Solución

Karajan Code resuelve ambos problemas encadenando **roles** con **quality gates** y **controles de coste**:

<div class="pipeline-carousel" id="pipeline-carousel">
  <div class="pipeline-track">
    <div class="pipeline-slide">
      <div class="pipeline-step-number">1</div>
      <div class="pipeline-step-icon">&#128187;</div>
      <h3>Coder</h3>
      <p>El rol <strong>coder</strong> escribe código y tests — ejecutado por el agente IA que tú elijas (ej. Claude, Codex, Gemini).</p>
    </div>
    <div class="pipeline-slide">
      <div class="pipeline-step-number">2</div>
      <div class="pipeline-step-icon">&#128737;</div>
      <h3>Guards Deterministas</h3>
      <p>Guards basados en regex escanean el diff buscando <strong>operaciones destructivas</strong>, <strong>fugas de credenciales</strong> y <strong>anti-patrones de rendimiento</strong>. Sin LLM.</p>
    </div>
    <div class="pipeline-slide">
      <div class="pipeline-step-number">3</div>
      <div class="pipeline-step-icon">&#128269;</div>
      <h3>Análisis Estático</h3>
      <p><strong>SonarQube</strong> realiza análisis estático completo con quality gates. Opcionalmente complementado por <strong>SonarCloud</strong> para análisis advisory en la nube.</p>
    </div>
    <div class="pipeline-slide">
      <div class="pipeline-step-number">4</div>
      <div class="pipeline-step-icon">&#128065;</div>
      <h3>Reviewer</h3>
      <p>El rol <strong>reviewer</strong> revisa el código buscando issues (ej. Codex). El scope filter auto-difiere items fuera de scope como deuda técnica.</p>
    </div>
    <div class="pipeline-slide">
      <div class="pipeline-step-number">5</div>
      <div class="pipeline-step-icon">&#128260;</div>
      <h3>Iterar o Aprobar</h3>
      <p>Si hay problemas, el <strong>coder recibe otra oportunidad</strong>. El bucle se repite hasta que el código es aprobado o se alcanza el límite de iteraciones.</p>
    </div>
    <div class="pipeline-slide">
      <div class="pipeline-step-number">6</div>
      <div class="pipeline-step-icon">&#128170;</div>
      <h3>Guardarraíles Integrados</h3>
      <p><strong>Máximo de iteraciones</strong>, <strong>timeouts por iteración</strong>, <strong>timeout de sesión</strong> y <strong>topes de presupuesto</strong> (USD/EUR). Fail-fast para bucles. Informes de coste con <code>kj report --trace</code>.</p>
    </div>
  </div>
  <div class="pipeline-progress">
    <div class="pipeline-progress-bar"></div>
  </div>
  <div class="carousel-controls">
    <button class="carousel-btn carousel-prev" aria-label="Anterior">&#8249;</button>
    <div class="carousel-dots" id="pipeline-dots"></div>
    <button class="carousel-btn carousel-next" aria-label="Siguiente">&#8250;</button>
  </div>
</div>

## Características Principales

<div class="features-carousel" id="features-carousel">
  <div class="carousel-track">
    <div class="carousel-slide">
      <h3>Pipeline basado en Roles</h3>
      <p>15 roles especializados — cada uno asignable a cualquier agente. Triage, discover, researcher, architect, planner, coder, refactorer, sonar, reviewer, hu-reviewer, tester, security, audit, solomon, commiter.</p>
    </div>
    <div class="carousel-slide">
      <h3>5 Agentes IA</h3>
      <p>Claude, Codex, Gemini, Aider, OpenCode — combínalos por rol. Extensible via plugins en <code>.karajan/plugins/</code>.</p>
    </div>
    <div class="carousel-slide">
      <h3>Servidor MCP — 23 Herramientas</h3>
      <p>Usa <code>kj</code> desde tu agente IA. Herramientas standalone: <code>kj_discover</code>, <code>kj_triage</code>, <code>kj_researcher</code>, <code>kj_architect</code>, <code>kj_hu</code>. Notificaciones de progreso en tiempo real.</p>
    </div>
    <div class="carousel-slide">
      <h3>Guards Deterministas</h3>
      <p>Output guard bloquea operaciones destructivas y fugas de credenciales. Perf guard detecta anti-patrones frontend. Intent classifier pre-clasifica sin coste LLM.</p>
    </div>
    <div class="carousel-slide">
      <h3>Injection Guard</h3>
      <p>Escáner de inyección de prompts que protege la revisión de código por IA contra manipulación. Detecta directivas override, caracteres Unicode invisibles y payloads de comentarios sobredimensionados. También se ejecuta como GitHub Action en cada PR.</p>
    </div>
    <div class="carousel-slide">
      <h3>Gestor Integrado de HUs</h3>
      <p>Auto-descompone tareas complejas en historias de usuario (HUs) formales. El triage activa hu-reviewer para tareas medias/complejas, generando 2-5 HUs con dependencias. Cada HU ejecuta su propio sub-pipeline (coder→sonar→reviewer) con tracking de estado. Integración completa con PG y visualización en el board.</p>
    </div>
    <div class="carousel-slide">
      <h3>SonarQube + SonarCloud</h3>
      <p>Análisis estático dual: SonarQube (Docker local, quality gates bloqueantes) y SonarCloud (cloud, advisory). Ambos se ejecutan juntos en el mismo pipeline.</p>
    </div>
    <div class="carousel-slide">
      <h3>TDD Obligatorio</h3>
      <p>Se exigen cambios en tests cuando se modifican ficheros fuente. El pipeline rechaza iteraciones sin tests correspondientes.</p>
    </div>
    <div class="carousel-slide">
      <h3>Comandos de Rol Standalone</h3>
      <p><code>kj discover</code>, <code>kj triage</code>, <code>kj researcher</code>, <code>kj architect</code> — ejecuta cualquier rol pre-build de forma independiente desde CLI o MCP.</p>
    </div>
    <div class="carousel-slide">
      <h3>Tracking de Presupuesto</h3>
      <p>Conteo de tokens por sesión con coste estimado equivalente a API. Karajan no tiene coste adicional — usa tus suscripciones CLI.</p>
    </div>
    <div class="carousel-slide">
      <h3>Resilient Run</h3>
      <p>Auto-diagnostica fallos y reanuda sesiones caídas — hasta 2 reintentos. Errores no recuperables fallan inmediatamente. Configurable via <code>session.max_auto_resumes</code>.</p>
    </div>
    <div class="carousel-slide">
      <h3>Automatización Git</h3>
      <p>Auto-commit, auto-push, auto-PR tras aprobación. Perfiles de revisión: standard, strict, relaxed, paranoid.</p>
    </div>
    <div class="carousel-slide">
      <h3>Gestión Inteligente de Sesiones</h3>
      <p>Pausa/reanudación con detección fail-fast. Resiliencia ante rate limits con auto-fallback. Checkpoints interactivos cada 5 minutos.</p>
    </div>
    <div class="carousel-slide">
      <h3>Descomposición de Tareas</h3>
      <p>Triage detecta cuándo dividir tareas y crea subtareas vinculadas en <a href="https://github.com/manufosela/planning-game-xp">Planning Game</a>.</p>
    </div>
  </div>
  <div class="carousel-controls">
    <button class="carousel-btn carousel-prev" aria-label="Anterior">‹</button>
    <div class="carousel-dots"></div>
    <button class="carousel-btn carousel-next" aria-label="Siguiente">›</button>
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

## Calidad y Testing

Karajan Code está testeado con **2318 tests automatizados** en 182 ficheros de test, cubriendo cada rol del pipeline, guard, opción de config y herramienta MCP. La suite de tests se ejecuta en menos de 14 segundos con Vitest.

La calidad se aplica en múltiples capas:
- **SonarQube** (local, via Docker) — análisis estático completo con quality gates, bloquea en issues críticos
- **SonarCloud** (cloud, sin Docker) — análisis cloud complementario, modo advisory por defecto
- **Guards deterministas** — checks basados en regex para operaciones destructivas, fugas de credenciales y anti-patrones de rendimiento
- **TDD obligatorio** — los cambios en código fuente requieren cambios correspondientes en tests

Tanto SonarQube como SonarCloud pueden ejecutarse juntos en el mismo pipeline — SonarQube como gate primario y SonarCloud como lente adicional.

## Dos Modos

Karajan ofrece dos formas de trabajar:

**Modo Skills** — 8 slash commands (`/kj-code`, `/kj-review`, `/kj-run`, etc.) instalados directamente en Claude Code. Cada comando incluye guardrails integrados. Sin servidor MCP — ideal para flujos con un solo agente. Instalar con `kj init`.

**Modo Orchestrator** — Servidor MCP completo con 23 herramientas. Pipeline multi-agente con orquestación de subprocesos, gestión de sesiones, tracking de presupuesto y resiliencia ante rate limits. Ideal para tareas complejas e integración CI/CD.

Ambos modos pueden convivir. Usa skills para tareas rápidas y el orchestrator cuando necesites múltiples agentes o control total del pipeline. Ver la [Guía de Skills](/docs/es/guides/skills/) para detalles.

## Siguientes Pasos

- [Instalación](/docs/es/getting-started/installation/) — Instalar Karajan Code
- [Inicio Rápido](/docs/es/getting-started/quick-start/) — Ejecutar tu primera tarea
- [Modo Skills](/docs/es/guides/skills/) — Usar como slash commands
