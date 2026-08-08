// @ts-check
/**
 * Fuentes canónicas de la documentación de la familia Karajan.
 *
 * Cada entrada declara un fichero markdown de un repo hermano (pinneado a
 * un tag) y cómo se parte en páginas Starlight. La fuente de verdad es el
 * repo de origen: estas páginas se REGENERAN con `npm run sync:family-docs`
 * — nunca se editan a mano (KJL-TSK-0112).
 *
 * `pages[n].start` es la línea de heading EXACTA donde empieza la página
 * (null = inicio del documento). Cada página termina donde empieza la
 * siguiente. Si un heading desaparece de la fuente, el sync FALLA con el
 * heading exacto: señal de resincronizar este config con la nueva versión.
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
];
