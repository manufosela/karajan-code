# Paquete de auditoría — Política de sensibilidad y redacción PII

> Preparación para la **auditoría externa** exigida como criterio de salida
> hacia la 1.0 (ver [ROADMAP](../../ROADMAP.md)). Este documento da al
> auditor el alcance, el modelo de amenazas, el inventario de flujos y el
> resultado de la revisión interna — sin arqueología de código.
>
> Última revisión interna: **2026-07-23** (KJR-TSK-0130 + cierre de
> hallazgos en KJR-BUG-0006 y KJR-TSK-0132).

## 1. Alcance

**En alcance:**
- La política de sensibilidad: `src/policy/sensitivity-policy.js`
  (`createDefaultSensitivityPolicy`, `validateSensitivityPolicy`,
  `resolveAdapterFor`, `isProviderAllowed`).
- La clasificación de niveles: `src/domain/document.js`
  (`SENSITIVITY_LEVELS = confidential | internal | public`,
  `classifySensitivity`).
- El redactor PII: `src/redaction/pii-redactor.js` (`redactPII`) y su rol de
  pipeline `RedactionRole`.
- Todos los caminos por los que contenido del usuario puede salir hacia un
  proveedor de IA (inventario en §3).

**Fuera de alcance:** la seguridad de los proveedores externos, el cifrado
en reposo de los stores (delegado en Postgres/LanceDB/disco), y la
infraestructura de despliegue (cubierta por el módulo Terraform: API privada
por defecto, secretos en Secret Manager).

## 2. Modelo de amenazas

| # | Amenaza | Control previsto |
|---|---------|------------------|
| A1 | Contenido `confidential` enviado a un proveedor público (OpenAI, Anthropic HTTP, CLIs públicos) | Policy por nivel: `confidential → solo ollama` (local); `internal → ollama + nubes privadas`; `public → todos` |
| A2 | PII (emails, teléfonos, NIF/NIE, tarjetas) en prompts hacia cualquier proveedor | `redactPII` como defensa en profundidad, incluso cuando la policy permite el envío |
| A3 | Mezcla accidental de niveles en un mismo índice/consulta | Clasificación por documento (`classifySensitivity`) + filtrado en retrieval |
| A4 | Bypass de la policy por caminos nuevos (features posteriores al diseño) | Este inventario (§3) + revisión en cada minor; hallazgo H1 demuestra el riesgo |
| A5 | Exfiltración vía logs/telemetría | Los eventos de pipeline reportan tamaños, no contenido |

## 3. Inventario de flujos hacia proveedores de IA

| Camino | Sale contenido a | Policy aplicada | Redacción PII | Estado |
|--------|------------------|-----------------|---------------|--------|
| Pipeline declarativo (`run`) con `RedactionRole` en el grafo | El adapter del stage de generación | ✅ (`RedactionRole` bloquea por nivel) | ✅ (`redactPII` sobre cada chunk) | Diseño original, correcto |
| `GeneratorRole` usado directamente por código de usuario | El adapter elegido | ⚠️ responsabilidad del integrador (documentado) | ⚠️ ídem | Por diseño: API de bajo nivel |
| `karajan-rag query --answer` (capa easy) | El adapter resuelto por policy | ✅ nivel efectivo = máx. de chunks recuperados; `--adapter` no permitido → error | ✅ | Corregido 2026-07-23 (KJR-BUG-0006, PRs #114/#115) |
| `karajan-rag eval --judges` | Los jueces listados | ✅ gate por `--sensitivity` (default `internal`); juez no permitido → error | ✅ | Corregido 2026-07-23 (KJR-BUG-0006, PR #115) |
| `karajan-rag index` / `query` sin `--answer` / `serve` / `createRag().query()` | Nadie (retrieval local; embeddings con HashEmbedder local por defecto) | n/a | n/a | Sin salida a terceros con defaults |
| Embedders remotos (`openai-compatible` apuntado a un endpoint externo) | El endpoint de embeddings | ⚠️ riesgo del integrador (decisión H2, ver §4) | ❌ (degradaría el retrieval) | API de bajo nivel; la capa easy solo ofrece embedders locales |
| `eval` sin `--judges` | Nadie (métricas locales) | n/a | n/a | Offline puro |

## 4. Revisión interna — hallazgos

### H1 — La capa easy no aplica la sensitivity policy (ALTA) → ✅ CORREGIDO

`src/easy/` no referenciaba `resolveAdapterFor`, `classifySensitivity` ni
`redactPII`, pese a que ADR-005 §6 declara que los presets pasan siempre
por el routing y el redactor. `query --answer --adapter openai` enviaba
pregunta y contextos sin redactar a un proveedor público.

- **Mitigación (2026-07-22)**: `redactPII` sobre toda salida a LLM de la
  capa easy. Test: `tests/easy-sensitivity-mitigation.test.js`.
- **Fix completo (2026-07-23, KJR-BUG-0006, PRs #114/#115)**:
  `easy.sensitivity`/`easy.sensitivityRules` en `karajan.config.json`,
  nivel estampado por documento al indexar y heredado por los chunks; el
  nivel efectivo de una consulta es el **máximo** de los chunks
  recuperados; `enforceEasyAdapterPolicy` valida el adapter (elección
  explícita no permitida → error accionable, default → primer provider
  permitido con aviso); `eval --judges` gana `--sensitivity` con gate de
  jueces. Índices pre-0.7.0 sin marca cuentan como `internal`, nunca como
  `public`. Tests: `tests/easy-sensitivity-{metadata,enforcement}.test.js`.

### H2 — Embedders remotos sin gate de sensibilidad (MEDIA) → 🟡 DECISIÓN REGISTRADA

`createOpenAICompatibleEmbedder` puede apuntar a un endpoint externo; el
texto de los chunks viaja completo para embeberse, sin policy ni redacción
(redactar antes de embeber degradaría el retrieval).

**Decisión (2026-07-23, KJR-TSK-0132)**: documentación prescriptiva, no
bloqueo por policy. Razones: (1) la capa easy —la única con defaults— solo
ofrece embedders locales (`hash`, `transformers`), así que ningún usuario
llega a un embedder remoto sin escribir código contra la API de bajo
nivel; (2) en esa API el integrador ya elige store, adapter y policy
explícitamente, y un bloqueo genérico rompería despliegues legítimos
(endpoint de embeddings self-hosted, que es remoto pero privado). Regla
documentada: **embedders de terceros solo para corpus `public`**; para
`internal`/`confidential`, embedder local o endpoint bajo control del
integrador. El auditor externo puede re-evaluar esta decisión.

### H3 — Cobertura de patrones del redactor (BAJA) → ✅ CORREGIDO (IBAN)

`redactPII` cubría email, teléfono, NIF/NIE y tarjetas. **Desde 2026-07-23
(KJR-TSK-0132) cubre también IBAN** (ES e internacional, con y sin
separadores, ordenado antes que el patrón de tarjeta para que este no se
coma los dígitos), con placeholder `[REDACTED_IBAN]` y conteo
`counts.iban`. Siguen fuera: pasaportes y direcciones postales — defensa
en profundidad declarada como tal, no control primario.

### Verificaciones que pasaron

- La policy por defecto es correcta y cerrada: `confidential → [ollama]`,
  sin proveedores públicos en niveles restrictivos; los adapters nuevos
  (openai, anthropic) entraron SOLO en `public`, con tests de exclusión.
- `validateSensitivityPolicy` rechaza policies malformadas (niveles
  ausentes, providers no-string).
- `RedactionRole` bloquea por nivel antes de redactar y reporta
  `blockedBy`; 100% de cobertura de líneas en policy y redactor.
- El despliegue GCP no expone contenido: API privada por defecto (invoker
  IAM), `PG_URL` solo en Secret Manager, imagen sin secretos horneados.

## 5. Checklist para el auditor externo

1. ¿El inventario de flujos (§3) es exhaustivo? Buscar salidas a red no
   listadas (`fetch(`, `spawn`/`execa` de CLIs) fuera de `src/ai/` y
   `src/embedding/`.
2. Revisar el fix de KJR-BUG-0006 (PRs #114/#115): ¿el nivel efectivo de
   una consulta es el MÁXIMO de los chunks recuperados? ¿Hay forma de
   colar un adapter no permitido con elección explícita?
3. Intentar bypass de `RedactionRole` con PII ofuscada (espacios, unicode
   homoglyphs) y proponer patrones adicionales (H3).
4. Verificar que ningún evento de observabilidad (`onStage*`) ni log de la
   capa easy incluye contenido de chunks.
5. Revisar los prompts de sistema (`rerank-prompt`, `buildJudgePrompt`) —
   incluyen contenido de chunks por diseño; confirmar que solo se usan tras
   los gates.
6. Confirmar que `karajan.config.json` y el manifest no persisten contenido,
   solo metadatos y hashes.
