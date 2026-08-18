// @ts-check
/**
 * Fuentes canónicas de la documentación de la familia Karajan.
 *
 * Cada entrada declara un fichero markdown de un repo hermano (pinneado a
 * un tag) y cómo se parte en páginas Starlight. La fuente de verdad es el
 * repo de origen: estas páginas se REGENERAN con `npm run sync:family-docs`
 * — nunca se editan a mano (KJL-TSK-0112).
 *
 * Dos modos por fuente:
 * - `path` + `pages`: un fichero partido en páginas por headings.
 *   `pages[n].start` es la línea de heading EXACTA donde empieza la
 *   página (null = inicio). Cada página termina donde empieza la
 *   siguiente. Heading ausente = el sync FALLA (resincronizar config).
 * - `files`: varios ficheros, cada uno una página 1:1. Los enlaces
 *   relativos entre ficheros del mismo grupo se reescriben a la página
 *   hermana local (`../<slug>/`); el resto se absolutiza al blob.
 */
export const sources = [
  {
    repo: 'manufosela/karajan-rag',
    ref: 'v1.5.0',
    path: 'docs/easy-rag.md',
    outDir: 'src/content/docs/es/karagan',
    translationDir: 'src/content/docs/karagan',
    pages: [
      {
        start: null,
        slug: 'quickstart',
        title: 'RAG en 5 minutos',
        description:
          'Indexa y consulta una base de código, documentos o datos sin escribir una línea de código. Offline y sin credenciales.',
      },
      {
        start: '### Un motor, tres estrategias de contexto',
        slug: 'context-strategies',
        title: 'El motor de estrategias de contexto',
        description:
          'rag, cag e hybrid sobre el mismo índice, y eval --compare-modes para decidir con datos qué contexto viaja al modelo.',
      },
      {
        start: '## 3. Servir',
        slug: 'serve',
        title: 'Servir y personalizar',
        description:
          'Servidor MCP para agentes, HTTP API con playground web y karajan.config.json como defaults del proyecto.',
      },
      {
        start: '## 5. Sensibilidad y privacidad',
        slug: 'sensitivity',
        title: 'Sensibilidad y privacidad',
        description:
          'Niveles public/internal/confidential por corpus o prefijo, routing de proveedores por policy y redacción PII en profundidad.',
      },
      {
        start: '## 6. En contenedor',
        slug: 'deploy',
        title: 'Contenedor y Google Cloud',
        description:
          'Docker, docker compose con pgvector y despliegue GCP con Terraform: Cloud Run + Cloud SQL + Secret Manager, privado por defecto.',
      },
      {
        start: '## SDK embebible (frameworks, sin CLI)',
        slug: 'sdk',
        title: 'SDK embebible',
        description:
          'createRag() en Astro, Next o Fastify: el mismo RagService del CLI, con los tres modos y el camino guardado.',
      },
    ],
  },
  {
    repo: 'manufosela/karajan-watch',
    ref: 'v0.3.0',
    outDir: 'src/content/docs/es/watch',
    translationDir: 'src/content/docs/watch',
    files: [
      {
        path: 'docs/design.md',
        slug: 'design',
        title: 'Diseño y fases',
        description:
          'El problema (contexto de TODO el código, daño colateral, docs desactualizadas), la arquitectura de tres capas y las fases del producto.',
      },
      {
        path: 'docs/config.md',
        slug: 'config',
        title: 'Configuración',
        description:
          'karajan-watch.config.json: el contrato entre el producto genérico y el repo de despliegue de cada organización, con validación estricta.',
      },
      {
        path: 'docs/ingest.md',
        slug: 'ingest',
        title: 'Ingesta por merge',
        description:
          'El workflow reusable ingest.yml: reindex incremental del corpus compartido en cada merge, con embedder local en el runner.',
      },
      {
        path: 'docs/impact.md',
        slug: 'impact',
        title: 'Impacto cross-repo',
        description:
          'Cuatro señales — retrieval, co-cambios git, contratos y juicio LLM — y un ranking de riesgo con evidencia, nunca una probabilidad.',
      },
      {
        path: 'docs/drift.md',
        slug: 'drift',
        title: 'Deriva de documentación',
        description:
          'Qué secciones de la documentación mencionan lo que acabas de cambiar — con el enlace duro código↔docs de los contratos.',
      },
      {
        path: 'docs/eval.md',
        slug: 'eval',
        title: 'Eval y calibración',
        description:
          'Golden set de incidentes reales: precision/recall@k del ranking, usable como gate en CI al cambiar umbrales o embedder.',
      },
      {
        path: 'docs/karajan-rag-contract.md',
        slug: 'engine-contract',
        title: 'Contrato con el motor',
        description:
          'Qué API de karajan-rag consume watch y qué gaps se han propuesto upstream: watch orquesta, nunca reimplementa mecánica de RAG.',
      },
    ],
  },
];
