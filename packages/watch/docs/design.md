# karajan-watch — diseño y plan de fases

> Documento de arranque (2026-07-23), destilado de la sesión de diseño en
> karajan-rag. Es el contrato de contexto para cualquier sesión que
> trabaje aquí: léelo entero antes de tocar código.

## 1. Problema

Una organización con N repos y agentes IA trabajando en ellos necesita:

1. Que los agentes tengan **contexto de TODO el código**, no solo del
   repo donde trabajan — un RAG compartido, siempre fresco.
2. Saber, cuando algo se mergea en un repo, **qué otros repos pueden
   verse afectados** (daño colateral) — la idea principal.
3. Saber **qué documentación se queda desactualizada** con cada cambio
   de código.

## 2. Arquitectura de tres capas

- **karajan-rag** (motor, existe): index/query/serve, retrieval híbrido,
  manifest incremental, sensitivity policy + redactPII (auditados),
  stores lancedb/pgvector, Terraform GCP validado, eval con golden set.
- **karajan-watch** (este repo, producto): la orquestación genérica.
  Sin datos de ninguna organización. Publicable en npm.
- **Repo de despliegue por organización** (privado, de la organización):
  configuración concreta — lista de repos, niveles de sensibilidad,
  infra, umbrales, destinos de aviso, golden set de calibración.

El despliegue real de cada organización vive en su propio repo, en
su org de GitHub, con identidad corporativa — NO aquí.

## 3. Componentes del producto

### 3.1 Ingesta por merge (F1)

- **Workflow reusable de GitHub Actions** (`.github/workflows/` +
  action publicable): en merge a la rama principal de un repo observado
  → checkout → `karajan-rag index --store pgvector` del workspace.
- El reindex es incremental (manifest de karajan-rag): solo se reprocesa
  lo tocado por la PR. El manifest compartido vive junto al corpus (GCS
  en el despliegue GCP).
- **Embedder local en el runner** (transformers) — el código NUNCA viaja
  a un embedder de terceros. La sensibilidad del corpus la declara la
  capa de despliegue; default seguro `internal`.
- Dos corpus separados: `code` (multi-repo, paths namespaceados
  `repo/…`) y `docs`. Tablas pgvector separadas.
- Servir a agentes: `karajan-rag serve` (MCP/HTTP) sobre cada corpus.
  **Gap upstream detectado**: serve multi-corpus en un solo proceso —
  mientras tanto, un servicio por corpus.

### 3.2 Pipeline de impacto cross-repo (F2 — el corazón)

Honestidad primero: **la similitud vectorial no es análisis causal de
impacto**. El pipeline combina tres señales:

1. **Retrieval**: cada chunk del diff mergeado como query contra el
   corpus `code`, filtrando fuera el repo de origen → candidatos por
   similitud semántica + BM25 (nombres de funciones, endpoints,
   esquemas). *Gap upstream*: filtro por prefijo/repo en query; mientras
   tanto se filtra post-hoc sobre `hit.source`.
2. **Co-cambios git**: minar el historial — cuando históricamente se
   tocó el área X del repo A, ¿qué se tocó en el repo B en ventanas
   cercanas? Señal barata, complementaria e independiente del contenido.
3. **Juicio LLM**: un adapter PERMITIDO POR LA POLICY (nivel del corpus)
   recibe diff + candidatos + co-cambios y emite veredicto estructurado:
   qué afecta, por qué, severidad.

Salida: **ranking de riesgo con evidencia** (nunca "probabilidad"
calibrada) → comentario en la PR / aviso al canal que configure la capa
de despliegue. Calibración: golden set de incidentes reales pasados
(mecánica de eval de karajan-rag) para medir precisión/recobrado del
ranking y ajustar umbrales.

### 3.3 Deriva de documentación (F3)

Mismo esqueleto que 3.2 con el corpus `docs` como objetivo: diff → 
retrieval sobre docs → candidatos "estas secciones mencionan lo que has
cambiado" → juicio LLM opcional para filtrar ruido → informe "docs a
actualizar" con enlaces sección a sección.

## 4. Reglas duras heredadas de la familia

- **Sensibilidad primero**: el código de una organización es `internal`
  como mínimo. Embedders locales; juicios LLM solo por adapters que la
  policy permita para el nivel efectivo; redactPII en toda salida.
- **Sin fallbacks silenciosos**: ingesta que no puede indexar = job en
  rojo, nunca "verde con índice a medias".
- **Privacidad en artefactos públicos**: este repo es público — jamás
  datos, nombres de repos privados ni referencias de organizaciones
  concretas en código, tests, docs o ejemplos.
- **Genérico o no entra**: cualquier valor concreto de una organización
  es un parámetro de la capa de despliegue.

## 5. Fases

- **F1 — RAG compartido vivo**: workflow reusable de ingesta +
  convenciones de workspace multi-repo + serve para agentes. Reusa casi
  todo de karajan-rag; es la fase de fontanería.
- **F2 — Impacto cross-repo**: las tres señales + ranking + comentario
  en PR. Incluye el minero de co-cambios y el prompt de juicio con
  salida estructurada.
- **F3 — Deriva de docs**: corpus docs + informe de secciones afectadas.
- **Transversal**: features genéricas que surjan se proponen upstream a
  karajan-rag (serve multi-corpus, filtros de query por prefijo…), no se
  duplican aquí.

## 6. Decisiones abiertas (preguntar al usuario)

- Dónde corre la ingesta del primer despliegue: runners de CI vs Cloud
  Run job.
- Nombre/marca visual dentro de la familia (¿kaWATCHan? 😄 — pendiente).
- Alcance exacto del comentario de impacto en PR (¿bloquear merge nunca,
  solo avisar?).
