# Template — `kj architect`

## Cuándo usar este comando

Tienes una feature que requiere **decisiones arquitectónicas** antes de codear: estructura de capas, contratos entre módulos, patterns, schema de DB, integración con sistemas existentes. El architect devuelve un diseño con ADRs ligeros.

**No** uses esto para tareas pequeñas o que no requieren decisiones de diseño (un bug fix, una mejora de log, un test nuevo). El architect cobra LLM por decisiones que ya tomaste.

## Comando

```bash
kj architect --task-file tasks/arch-feature.task.md \
             --context "$(cat outputs/research-result.json)"  # opcional
```

Output: JSON o markdown estructurado con ADRs, diagrama de componentes, contratos.

## Plantilla

Copia esto a `tasks/arch-<nombre>.task.md`:

```markdown
# [REPLACE: Diseñar arquitectura de X]

## Feature a diseñar

[REPLACE: 2-4 párrafos describiendo:
 - Qué hace la feature de cara al usuario
 - Cuáles son las piezas técnicas obvias (no obligues a inventar)
 - Cuál es la integración con el sistema existente]

## Restricciones técnicas no negociables

[REPLACE: bullets concretos.
EJEMPLO:
- Stack actual: Astro + Lit + Firebase (no cambiar)
- DB: Firestore con multi-database (1 DB por tenant)
- Auth: GCIP multi-tenant
- Region: europe-west1 obligatoria por GDPR
- Sin TypeScript (proyecto usa JS + JSDoc)
- ≤200 LOC por PR; partir features grandes en HUs]

## Decisiones que YA están tomadas

[REPLACE: cosas que NO debe re-evaluar.
EJEMPLO:
- Tombstones para deletes persistentes (KJC-TSK-0380, ya implementado)
- Plan adherence metric en summary.md (KJC-TSK-0376)
- Catálogo de UI components: @manufosela/* (regla de proyecto)]

## Decisiones que SÍ tiene que tomar

[REPLACE: lista de preguntas arquitectónicas abiertas.
EJEMPLO:
1. ¿Cómo modelar la relación N:N entre Users y Teams (junction collection vs subcollection)?
2. ¿Cifrado a nivel campo en envelope encryption: server-side o client-side?
3. ¿Vector search vs SQL search para el componente de búsqueda full-text?
4. ¿Cron diario o webhook real-time para el trial expiry?
5. ¿Cómo gestionar la rotación de claves KMS sin disrupción?]

## Output esperado

[REPLACE: forma del resultado.
EJEMPLO:
- 1 ADR ligero por cada decisión, formato `decision + reasoning + alternatives + consequences`.
- Diagrama de componentes (texto, ASCII o mermaid) con flechas de dependencia.
- Schema de DB en JSON Schema-like.
- Contratos entre módulos (función signatures + JSDoc types).
- Tests de integración recomendados (lista de casos).
- Lista de riesgos técnicos con mitigación.]

## Lo que NO debe entrar

[REPLACE — opcional pero útil para enfocar.
EJEMPLO:
- NO incluir HUs ejecutables (eso es `kj plan generate`).
- NO incluir código de implementación (eso es `kj run`).
- NO discutir alternativas de stack ya descartadas (Postgres, Supabase).]
```

## Patrón ganador

El architect funciona bien cuando le das:

- **Restricciones técnicas firmes** (stack, region, compliance).
- **Decisiones cerradas** (lo que ya está implementado y no se va a cambiar).
- **Preguntas concretas abiertas** (no "diseña la solución" — sí "elige entre A, B, C para X").

Y mal cuando:

- Le pides que reconsidere todo el stack ("¿deberíamos usar Postgres?") — eso es un research / decision exec, no arquitectura.
- Le das una feature mal definida — el architect inventará casos de uso.
- Esperas que cubra UX o copywriting — el architect es para piezas técnicas.

## Encadenarlo con `kj plan generate`

```bash
kj architect --task-file tasks/arch-x.task.md --json > /tmp/arch.json
kj plan generate --task-file tasks/feature-x.task.md \
                 --context "$(cat /tmp/arch.json)"
```

El planner usa el ADR del architect como contexto y emite HUs que respetan las decisiones tomadas.

## Antiejemplo (qué NO funciona)

```markdown
Design the architecture for our new SaaS for managing teams.
```

Problema: el architect tiene que inventar TODO. Output: ADR genérico tipo "Use microservices because scalability". No te sirve.

Mejor:

```markdown
We're adding "team membership" to an existing Firestore-backed SaaS
(Astro + Lit + Firebase, KJC-TSK-0380 ya implementado). Tomar las
siguientes 3 decisiones: (1) junction collection vs subcollection,
(2) índices Firestore necesarios para listar membresías de un usuario,
(3) cifrado en reposo de los datos personales del miembro.
```

Decisiones concretas → ADRs útiles.
