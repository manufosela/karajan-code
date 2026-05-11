# Template — `kj discover`

## Cuándo usar este comando

Tienes una tarea/feature en la cabeza pero **no estás seguro de si está bien definida**. El discover detecta:

- Gaps (información que falta para empezar)
- Ambigüedades (decisiones implícitas que el coder podría interpretar mal)
- Dependencias externas no resueltas (credenciales, accesos, third-parties)

Te ahorra el ciclo "lanzas `kj run` → el coder pregunta → tú contestas → pivotea".

## Comando

```bash
kj discover --task-file tasks/discover-x.task.md --mode gaps
```

Modos disponibles:
- `gaps` (default) — qué información falta
- `momtest` — preguntas estilo "The Mom Test" para validar la idea
- `wendel` — análisis de risks tipo Wendel ("¿qué podría salir mal?")
- `classify` — clasifica la tarea (simple / medium / complex)
- `jtbd` — análisis Jobs-To-Be-Done

## Plantilla

Copia a `tasks/discover-<nombre>.task.md`:

```markdown
# [REPLACE: descubrir gaps en X antes de implementar]

## La tarea que estoy pensando hacer

[REPLACE: 2-4 párrafos describiendo lo que TÚ crees que hay que hacer.
EJEMPLO:
"Quiero añadir un sistema de invitaciones por email para co-líderes
en Equipazgo. El owner introduce el email, se le envía un magic-link
con token único de 7 días, y al pulsarlo el invitado entra a la
organización con rol co_leader."]

## Lo que YA sé / tengo decidido

[REPLACE: bullets concretos.
EJEMPLO:
- Email provider: SendGrid (ya configurado en otra parte del proyecto)
- Magic-link auth: Firebase Auth tiene built-in (`sendSignInLinkToEmail`)
- Token storage: tabla `invitations` en Firestore
- Plan Team o superior obligatorio]

## Lo que SOSPECHO que puede estar mal definido

[REPLACE: lista de cosas que sientes que no están del todo claras.
EJEMPLO:
1. ¿Qué pasa si el invitado ya tiene cuenta en otra organización?
2. ¿Cómo se gestiona la revocación si el token aún no ha sido usado?
3. ¿El owner ve "pending invitations" en algún sitio?
4. ¿Email rate-limiting para evitar abuso?
5. ¿El co_leader hereda permisos automáticamente o el owner debe configurarlos?]

## Lo que necesito del discover

[REPLACE: tipo de output esperado.
EJEMPLO:
- Lista exhaustiva de gaps con priorización (P0 bloqueante / P1 importante / P2 nice-to-have).
- Para cada gap: pregunta concreta + recomendación si la sabes.
- Riesgos no técnicos (legales, UX, abuse vectors).
- Dependencias externas pendientes (credenciales, configuraciones de Stripe, dominio verificado).]
```

## Patrón ganador

El discover funciona bien cuando le das:

- **Una idea concreta** (no genérica): "invitaciones por email para co-líderes" >>> "sistema de auth".
- **Lo que ya tienes decidido** para que se centre en lo abierto.
- **Tus dudas explícitas** para que profundice donde tú sientes vértigo.

Y mal cuando:

- La idea está demasiado verde — el discover acaba inventando preguntas genéricas.
- Pides "validar la idea de mi producto" — eso es customer research, no `kj discover`.

## Cuándo usar cada modo

| Modo | Cuándo |
|---|---|
| `gaps` | Quieres una lista accionable de "qué falta para empezar". Es el default y casi siempre lo correcto. |
| `momtest` | Validación temprana de una idea de producto — antes de codear. |
| `wendel` | Análisis de riesgos profundo — útil antes de release o de feature crítica. |
| `classify` | Cuando dudas si una tarea es de 1 hora o de 1 semana. |
| `jtbd` | Diseño de feature centrado en el job-to-be-done del usuario. |

## Encadenarlo

Tras `kj discover --mode gaps`, lo típico es:

1. Contestar las preguntas P0 + P1 explícitamente.
2. Reescribir el task file incorporando las respuestas.
3. Lanzar `kj plan generate` con el task file enriquecido.

El plan resultante es mucho más concreto que el que saldría sin discover.

## Antiejemplo (qué NO funciona)

```markdown
Build a SaaS. What should I consider?
```

Problema: el discover devolverá 50 preguntas genéricas inútiles (auth, billing, monitoring, scaling, GDPR...). Mejor empieza concreto y deja que discover detecte gaps de **tu** idea concreta, no del universo SaaS.
