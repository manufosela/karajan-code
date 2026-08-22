# Karajan Console: consola web de administracion de una instancia de la familia (rag + watch)

Status: accepted
Date: 2026-08-21 (propuesto y aceptado el mismo dia, con las respuestas de la seccion Decisiones)

## Context

Peticion de la sesion de tribbu-atlas (capa 3: despliegue de la familia para una organizacion; consume karajan-rag 1.5.0 por npm + modulo terraform deploy/gcp y karajan-watch 0.2.0 por npm + workflows reusables, referenciados por version, sin copiar nada). La instancia ya esta en produccion: dos corpus (code + docs) en Cloud Run privado con pgvector, MCP para los agentes del equipo. Hoy TODA la operacion es por CLI: dar acceso a una persona (IAM run.invoker), cargar credenciales (service account, token de Notion, webhook de Slack, tokens de GitHub), lanzar sync o reindex (workflow_dispatch), ver el estado de los corpus, ajustar umbrales o destinos de aviso en karajan-watch.config.json. La organizacion quiere hacerlo por web con cuentas de su dominio Google, sin terminal, aunque por debajo corran los mismos comandos.

Por el contrato de desacoplamiento de la familia ("aqui se configura, no se construye; lo generico va upstream") y por la regla de repos (ADR 0002: una sesion no toca repos ajenos), la consola es PRODUCTO de la familia y su implementacion vive aqui; la instancia solo aporta configuracion, credenciales y hosting. Es ademas el componente mas privilegiado del sistema (IAM, secretos, tokens): lo que se decida aqui se hereda en cada instancia.

Contexto interno: el HU Board (packages/hu-board) ya es el dashboard LOCAL de kj (SQLite, sin auth, un desarrollador, y desde hoy con la pestana Governance). No es la misma pieza: la consola es multiusuario, con identidad de organizacion y sobre servicios desplegados. Comparten kernel (karajan-core para procesos, @karajan-family/governance para el registro encadenado), no codigo de interfaz.

## Options

A) Paquete propio en el monorepo: packages/console, publicado como @karajan-family/console. Define OPERACIONES (accesos, estado, reindex, sync, credenciales, avisos, config, playground) con ADAPTADORES por proveedor (gcp-cloud-run, gcp-iam, gcp-secret-manager, github-workflow, github-secret, config-repo, slack). La instancia aporta console.config.json + credenciales + hosting. Versionado independiente: no fuerza subir watch antes de 1.0 (la consola valida con el validateConfig de la version PINNEADA por la instancia).

B) Parte de karajan-watch (la consola como "cara" de watch). Acopla el ciclo de releases de la consola al de watch (que va hacia 1.0 con cambios de config) y mete en un paquete de producto la capa mas privilegiada (IAM, secretos), que no es asunto de watch. Descartada.

C) Repo propio de la instancia (tribbu-atlas-console), como si la familia no existiera. MVP mas rapido hoy; duplica mecanica (estado, operaciones, avisos, auth) en cada organizacion, se desincroniza a cada version de watch y la seguridad se improvisa por instancia. Rompe el contrato de desacoplamiento. Descartada.

## Decision (propuesta, pendiente del usuario)

A. Paquete propio @karajan-family/console en packages/console, con estas decisiones:

1. Frontera producto/instancia. El producto define operaciones y la interfaz de adaptador; nada del producto sabe que existe una organizacion concreta. La instancia aporta console.config.json (trackeado en su repo de despliegue), las credenciales (fuera de git, por el cauce de C3) y el hosting.

2. Contratos hacia la instancia.
   - console.config.json (validado fail-loud al arrancar; forma v1):
     instance: { name, allowedDomains: ["tribbu.com"] }
     auth: { provider: "google", audience: <client id> }
     roles: { admins: [emails], operators: [emails], readers: ["@tribbu.com"] }   (el dominio entero puede ser reader)
     corpora: [{ id, name, adapter: "gcp-cloud-run", project, region, service, healthPath: "/health" }]
     operations: [{ id: "reindex-code", adapter: "github-workflow", repo, workflow: "reindex.yml", ref: "main", roles: ["operator"] }]
     secrets: [{ id: "notion-token", adapter: "gcp-secret-manager", project, name } | { id: "gh-token", adapter: "github-secret", repo, name }]
     configRepo: { adapter: "config-repo", repo, path: "karajan-watch.config.json", base: "main", watchVersion: "0.2.0" }
     audit: { sink: "gcs-jsonl" | "firestore" | "file", target }
   - Interfaz de adaptador (ES2025, sin clases obligatorias): { name, capabilities: [...], health(corpus), listAccess(corpus), grant(corpus, principal), revoke(corpus, principal), dispatch(operation, inputs) -> runRef, runStatus(runRef), runLog(runRef), secretWrite(secret, value) -> { version }, proposeConfigChange(configRepo, nextConfig, message) -> { prUrl } }. Cada adaptador declara solo las capacidades que implementa; una operacion que pida una capacidad ausente es error de carga del config, no un fallo en runtime.
   - Artefactos publicados: paquete npm (API como handler express exportable + la pagina estatica de la UI; ver Enmienda 1), imagen Docker (Cloud Run), y una plantilla `console init --target firebase|cloud-run` que genera el despliegue de referencia. El producto no obliga a Firebase: la API es Node normal.

3. Auth y permisos. Google OIDC con restriccion de dominio verificada EN SERVIDOR (claim hd en allowedDomains y email_verified); allowedDomains es config de instancia. Roles: reader (estado, historico, playground con SU token), operator (+ sync/reindex, + config de avisos via PR), admin (+ accesos IAM, + credenciales). Los roles viven en console.config.json (git): cambiar un permiso es un PR revisable, no un clic en una base de datos.

4. Seguridad. Registro de auditoria append-only hash-encadenado con recordDecision/verifyDecisionChain de @karajan-family/governance (quien, accion, objetivo, resultado, prev): la misma cadena que kj usa para las decisiones de policy, ahora para operaciones de infraestructura. Service account propia de la consola con permisos acotados a los recursos declarados (run.invoker binding solo sobre los servicios de corpora[], secretVersionAdder solo sobre secrets[]). Las credenciales son de solo escritura: no existe endpoint de lectura por diseno. Tokens de GitHub via GitHub App (installation tokens cortos), nunca PAT persistido. kj audit --security obligatorio antes de cada review del paquete. Sin fallbacks silenciosos.

5. Fases (cada una usable sola): C0 esqueleto + auth + roles + auditoria + config validado (sin operaciones) · C1 accesos y estado (PRIMERA instanciable en tribbu-atlas) · C2 operaciones (workflow_dispatch + log del run) · C3 credenciales · C4 avisos y config de watch via PR (validateConfig de la version pinneada) · C5 playground (reutilizar la UI de serve --http con el ID token del usuario; mejor cuando el motor exponga MCP por HTTP).

6. Contexto entre sesiones. Lo publicado es el contrato: este ADR y docs/family-contracts.md en el monorepo (publico), las cards de la epica KJC-PCS-0080 en el Planning Game (proyecto Karajan Code) y las cards de gaps en Karajan RAG (KJR) y Karajan Watch (KJW). La sesion de instancia escribe proposals/cards con contexto en esos boards y registra colecciones qmd de los docs publicados; nadie toca el repo del otro.

## Consequences

Un paquete nuevo en el monorepo con su propio ciclo (semver independiente), adaptadores GCP/GitHub desde la fase C1 (mas lento que un MVP de instancia, deliberadamente). Los gaps upstream hallados al desplegar (exclude en karajan.config.json, imagen con embedder y @huggingface/transformers, MCP sobre HTTP, Cloud SQL compartida y propiedad de google_project_service en deploy/gcp, ingest docs con fuentes propias, clasificacion de repos y sensitivityRules en el config de watch, Auth Proxy con WIF en los workflows) quedan cardeados en KJR y KJW y condicionan C2, C4 y C5. La instancia aporta: un console.config.json real, la lista de operaciones con sus workflows e inputs, los principales IAM, el sink de auditoria elegido, y pruebas de C1 contra sus Cloud Run.

## Decisiones (Manu, 2026-08-21, sobre las cuatro preguntas abiertas)

1. Roles por email ahora; los grupos de Google Workspace (group:equipo@dominio) llegan en una fase posterior.
2. Sink de auditoria por defecto: gcs-jsonl (bucket con versionado y retencion, escritura append-only), verificable offline con la cadena de governance. Firestore, si hace falta consultar desde la UI, solo como espejo de lectura, nunca como fuente.
3. Playground (C5): embeber la UI de `karajan-rag serve --http` con el ID token del usuario mientras el motor no exponga MCP sobre HTTP (card KJR); reimplementar en Astro solo si esa card se retrasa.
4. Nombre: @karajan-family/console y binario `karajan-console`.

## Aportado por la primera instancia (tribbu-atlas, PR #19 de su repo)

- console.config.json real con la forma v1; docs/console-instance.md con operaciones, principales IAM y sink. Sus cards: epica ATL-PCS-0006, ATL-TSK-0010 (instanciar C1, bloqueada por KJC-TSK-0777), ATL-TSK-0011 (probar C1 y devolver feedback).
- Modelo IAM que el producto asume como referencia: personas = roles/run.invoker sobre los servicios de corpora[] (grant/revoke desde C1); service account de la consola = roles/run.admin a nivel de SERVICIO (solo setIamPolicy sobre los corpus declarados, nunca a nivel de proyecto) + roles/storage.objectCreator sobre el bucket del sink (sin objectAdmin: append-only), creada por el terraform de la instancia; GitHub App instalada solo en el repo de despliegue con actions:write (C2), secrets:write (C3), contents:write + pull_requests:write (C4), installation tokens cortos. Los secrets de Secret Manager del modulo deploy/gcp quedan fuera del alcance de la consola.
- Requisito: `console init --target firebase` genera el despliegue de referencia sobre el proyecto GCP EXISTENTE del RAG (instance.project en el config), nunca uno nuevo; el bucket del sink lo crea el despliegue de la consola, no el modulo del RAG.
- Matices de operaciones (C2, entregado el 22-ago): reindex-code queda PENDIENTE hasta KJW-TSK-0038 (Auth Proxy con WIF en los workflows) y KJR-TSK-0153 (exclude en el motor); observed-merge es un evento repository_dispatch, no una operacion: la consola solo muestra su historico (C4).

## Enmienda 1 (Manu, 2026-08-22): la pagina es estatica plana, sin Astro y sin build

La decision original decia "build estatico Astro de la UI" (Artefactos publicados, punto 3). C1-UI (KJC-TSK-0785) se entrego como HTML + CSS + JavaScript planos en `packages/console/ui/`, servidos por la propia API con `express.static` desde `/`; el paquete publica `ui/` tal cual y `createConsoleApp({ ui: false })` deja un proceso solo-API. Motivo: una sola pagina no justifica un paso de build ni una dependencia de framework; con Astro habria que construir antes del pack y sostener esa cadena para una pagina. Se valoro tambien reutilizar el HU Board: otra audiencia y sin auth de dominio.

Queda enmendado: el artefacto de interfaz es estatico plano servido por la API (o por Hosting con `rewrite /api/** -> el servicio`, mismo origen y sin CORS). Si algun dia la consola necesita varias paginas o documentacion propia, volver a valorar Astro sera una decision nueva: el mismo HTML y JS entran en `src/pages/index.astro` sin reescritura.

Sin cambios en el resto del ADR. La entrada 3 de Decisiones (playground C5 embebiendo la UI de `serve --http`) sigue vigente; su mencion a "reimplementar en Astro" se lee ahora como "reimplementar en la pagina estatica de la consola".
