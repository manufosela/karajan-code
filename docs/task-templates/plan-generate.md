# Template — `kj plan generate`

## Cuándo usar este comando

Tienes una feature de tamaño medio-grande (≥ 5 HUs) y necesitas que Karajan la descomponga en HUs ejecutables, con dependencias, sprints estimados, riesgos y out-of-scope. **No** uses esto para tareas simples (1-3 HUs); para eso usa `kj run` directo.

## Comando

```bash
kj plan generate --task-file <path>.task.md -y 2>&1 | tee outputs/plan-raw.log
```

- `-y` salta el prompt del project name (usa el default).
- `tee` captura el output del planner por si quieres inspeccionar progreso.

El plan resultante se guarda en `~/.kj/plans/<projectSlug>/plan-<id>.json` (la ruta exacta sale en stdout al final).

## Plantilla

Copia esto a `tasks/01-<nombre-feature>.task.md` y rellena:

```markdown
# [REPLACE: Título corto de la feature — 1 línea]

[REPLACE: Una frase: necesito que descompongas en HUs ejecutables el [feature X] del proyecto Y.]

## Qué construimos en este plan

[REPLACE: 3-5 párrafos narrativos describiendo:
 - Actores (quién usa esta feature)
 - Flujo principal (qué pasa de inicio a fin)
 - Datos/entidades clave
 - Diferencias vs lo que YA existe en el proyecto]

**NO incluye en este plan**: [REPLACE: lista las features que pertenecen a OTROS planes futuros, para que el planner no las arrastre.]

## Stack técnico ya decidido

- **Frontend**: [REPLACE: Astro + Lit / React + Vite / etc.]
- **Backend**: [REPLACE: Cloud Functions / Express / etc.]
- **DB**: [REPLACE: Firestore / Postgres / etc.]
- **Auth**: [REPLACE: GCIP / Auth0 / etc.]
- **Hosting**: [REPLACE: Firebase Hosting / Vercel / etc.]
- **Region / compliance**: [REPLACE: europe-west1 GDPR / us-east1 / etc.]

[OPTIONAL: lista de paquetes externos ya decididos]

## Funcionalidades a descomponer en HUs

[REPLACE: lista numerada de 15-30 items en lenguaje natural.
Formato preferido: prosa corta describiendo QUÉ hace cada cosa.

EJEMPLO BUENO:
1. Líder se registra con email+password o OAuth Google/Microsoft.
2. Al registrarse, una Cloud Function crea atómicamente la organización
   (tenant + DB + bucket + KMS key). Si algún paso falla, rollback completo.
3. ...

EJEMPLO MALO:
| ID | Caso | Actor | Precondiciones |
| AUTH-001 | Registrarse | líder | email no registrado |
| ...
(eso parece un plan ya hecho — el LLM lo reformateará en vez de diseñar)
]

## Reglas no negociables

[REPLACE: bullets concisos.
EJEMPLO:
- Aislamiento entre tenants: nunca cross-org. Tests de aislamiento en CI.
- Auth obligatoria: cada Cloud Function valida pertenencia al tenant.
- Cifrado: CMEK en reposo; envelope para campos muy sensibles.
- Owner vs co_leader: solo owner gestiona suscripción, ownership y borrado.
- Audit log inmutable para GDPR/billing/membership.]

## Spikes técnicos (HUs separadas)

[REPLACE: cosas de infraestructura/setup que NO son features de usuario pero deben hacerse antes.
EJEMPLO:
- Setup proyecto GCP + Firebase + GCIP multi-tenancy + KMS.
- Setup Stripe (productos, planes, webhooks idempotentes).
- Setup CI/CD GitHub Actions.
- Plantilla DPIA + privacy notice (paralelo, no bloqueante).]

## Lo que necesito que generes

Una lista de HUs **atómicas y ejecutables individualmente con `kj run`** (cada una es una unidad de trabajo de un coder). Para cada HU:

- **ID** con prefijo de épica: `[AUTH-001]`, `[PEOPLE-005]`, `[INFRA-003]`, etc.
- **Título** breve.
- **Historia** "como [actor], quiero [acción], para [valor]".
- **3-8 criterios de aceptación** verificables.
- **Dependencias** entre HUs (las que deben completarse antes). Si una HU no depende de nada, lista vacía. **NO encadenar HUs por orden de aparición.**
- **Estimación** XS / S / M / L / XL.
- **Notas técnicas** según el stack.
- **Subset MVP** mínimo (las HUs imprescindibles para validar el flujo end-to-end).
- **Plan de sprints** de 2 semanas con HUs agrupadas (asume equipo 2-3 devs + 1 designer).
- **Checklist de dependencias externas** pre-requisito (cuentas cloud, dominio, etc.).

**Importante**: NO escribas un documento markdown describiendo las HUs. Genera HUs reales como entradas separadas, cada una ejecutable por separado. Idioma de las HUs: [REPLACE: español / english].
```

## Ejemplo concreto que funcionó

Mira [`tasks/04-plan-1-simple.task.md` en el proyecto de Equipazgo](https://github.com/manufosela/karajan-code/blob/main/PERSONAL) (97 líneas) — generó 45 HUs reales con dependencias correctas tras los fixes KJC-BUG-0041/KJC-TSK-0382.

## Antiejemplo (qué NO funciona)

Un task de 353 líneas con cada épica enumerada en una tabla `| ID | Actor | Precondiciones | Postcondiciones |` con los 30+ casos de uso ya escritos. El planner lo tratará como "documento ya hecho" y producirá meta-documentación. Reportado como KJC-BUG-0041 en dogfooding 2026-05-10.

## Verificación del plan generado

Tras la generación, inspecciona:

```bash
PLAN=~/.kj/plans/<projectSlug>/plan-<id>.json

# Total de HUs
jq '.hus | length' $PLAN

# Distribución de dependencias (cuántas HUs sin deps, cuántas con 1, 2, ...)
jq '[.hus[] | .blocked_by | length] | group_by(.) | map({deps: .[0], count: length})' $PLAN

# Issues que el reviewer detectó
jq '.review' $PLAN
```

**Bandera roja**: si el array de dependencias es `[count(0)=0, count(1)=N-1]` con N = total HUs (todas dependen de una), el bug de cadena lineal está activo. Verifica que tienes karajan-code >= 2.13.1.

**Bandera roja**: si todas son `[count(0)=N]` y el spec explícitamente declaraba "Depende: X", el bug de extracción de deps está activo. Verifica karajan-code >= 2.13.1.
