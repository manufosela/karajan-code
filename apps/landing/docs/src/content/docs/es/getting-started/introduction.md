---
title: Introducción
description: Qué es Karajan Code y por qué usarlo.
---

**Un comando. Múltiples agentes IA. Pipeline de calidad completo.**

Karajan Code (`kj`) orquesta agentes de IA como un director de orquesta dirige una sinfonía. Tú defines **qué** tiene que pasar — codificar, revisar, testear, securizar — y Karajan asigna **quién** hace cada parte.

**13 roles especializados.** Triage, researcher, architect, planner, coder, reviewer, tester, security, y más.

**5 agentes IA.** Claude, Codex, Gemini, Aider, OpenCode. Combínalos libremente.

**Sin coste adicional.** Funciona con tus suscripciones existentes — no necesitas API keys.

---

## El Problema

Hoy hay dos formas de usar agentes de IA para programar, y ambas tienen problemas serios:

**Uso manual** — Ejecutas un agente, esperas el código, lo revisas tú mismo, encuentras problemas, vuelves a hacer prompt y repites. Sin control de calidad sistemático. Lento. Depende enteramente de tu capacidad de revisión.

**Uso automatizado (CI/CD)** — Conectas agentes a pipelines que se ejecutan en cada push. Eliminas el cuello de botella manual, pero introduces **costes sin control**. Una sola tarea puede quemar tokens indefinidamente — agentes reintentando, reviewers en bucle, APIs inestables disparando reintentos ilimitados. Dinero real, sin visibilidad.

**En ambos casos:** no hay forma estándar de asegurar calidad, controlar el gasto, o saber cuándo parar.

## La Solución

<div class="solution-visual">
  <img src="/docs/img/pipeline-animation.gif" alt="Pipeline: 1) Coder escribe código y tests (ej. Claude) → 2) Guards deterministas escanean ops destructivas, fugas de credenciales, anti-patrones → 3) SonarQube análisis estático, opcionalmente complementado por SonarCloud → 4) Reviewer revisa el código (ej. Codex) → 5) Si hay problemas, el coder recibe otra oportunidad → 6) Bucle hasta aprobación o límite de iteraciones" loading="lazy" />
</div>

Cada sesión tiene guardarraíles integrados: **máximo de iteraciones**, **timeouts por iteración**, **timeout total de sesión**, y opcionalmente **topes de presupuesto estimado** (en USD o EUR). La detección fail-fast para el bucle cuando los agentes dan vueltas en círculos.

## Características Principales

<div class="features-carousel" id="features-carousel">
  <div class="carousel-track">
    <div class="carousel-slide">
      <h3>Pipeline basado en Roles</h3>
      <p>13 roles especializados — cada uno asignable a cualquier agente. Triage, researcher, architect, planner, coder, refactorer, sonar, reviewer, tester, security, solomon, commiter.</p>
    </div>
    <div class="carousel-slide">
      <h3>5 Agentes IA</h3>
      <p>Claude, Codex, Gemini, Aider, OpenCode — combínalos por rol. Extensible via plugins en <code>.karajan/plugins/</code>.</p>
    </div>
    <div class="carousel-slide">
      <h3>Servidor MCP — 18 Herramientas</h3>
      <p>Usa <code>kj</code> desde tu agente IA. Herramientas standalone: <code>kj_discover</code>, <code>kj_triage</code>, <code>kj_researcher</code>, <code>kj_architect</code>. Notificaciones de progreso en tiempo real.</p>
    </div>
    <div class="carousel-slide">
      <h3>Guards Deterministas</h3>
      <p>Output guard bloquea operaciones destructivas y fugas de credenciales. Perf guard detecta anti-patrones frontend. Intent classifier pre-clasifica sin coste LLM.</p>
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

  carousel.addEventListener('mouseenter', () => clearInterval(autoTimer));
  carousel.addEventListener('mouseleave', resetAuto);

  let startX = 0;
  carousel.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  carousel.addEventListener('touchend', (e) => {
    const diff = startX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) goTo(current + (diff > 0 ? 1 : -1));
  }, { passive: true });

  carousel.setAttribute('tabindex', '0');
  carousel.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') goTo(current - 1);
    if (e.key === 'ArrowRight') goTo(current + 1);
  });

  resetAuto();
});
</script>

## Calidad y Testing

Karajan Code está testeado con **1559+ tests automatizados** en 128 ficheros de test, cubriendo cada rol del pipeline, guard, opción de config y herramienta MCP. La suite de tests se ejecuta en menos de 14 segundos con Vitest.

La calidad se aplica en múltiples capas:
- **SonarQube** (local, via Docker) — análisis estático completo con quality gates, bloquea en issues críticos
- **SonarCloud** (cloud, sin Docker) — análisis cloud complementario, modo advisory por defecto
- **Guards deterministas** — checks basados en regex para operaciones destructivas, fugas de credenciales y anti-patrones de rendimiento
- **TDD obligatorio** — los cambios en código fuente requieren cambios correspondientes en tests

Tanto SonarQube como SonarCloud pueden ejecutarse juntos en el mismo pipeline — SonarQube como gate primario y SonarCloud como lente adicional.

## Mejor con MCP

Karajan Code está diseñado para usarse como **servidor MCP** dentro de tu agente de IA (Claude, Codex, etc.). El agente envía tareas a `kj_run`, recibe notificaciones de progreso en tiempo real, y obtiene resultados estructurados — sin copiar y pegar.

## Siguientes Pasos

- [Instalación](/docs/es/getting-started/installation/) — Instalar Karajan Code
- [Inicio Rápido](/docs/es/getting-started/quick-start/) — Ejecutar tu primera tarea
