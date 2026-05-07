# TODO — Mejoras del deck de la charla (21 mayo 2026)

Notas, frases potentes e insights detectados durante el dogfooding
pre-charla. Para revisar el `~/karajan-talk-2026-05-21.pptx` cuando
acabe la batería de testing.

## Frases potentes (ya validadas con uso real)

- *"Cursor te da un diff. Karajan te da un informe arquitectónico
  que tu lead engineer aprobaría."*
  - Contexto: validada en testing N2.B con `kj researcher
    "¿Dónde decide Brain entre Solomon y fallback?"`. El output en
    90 s identificó 11 ficheros, 6 patterns con line numbers, 5
    constraints arquitecturales con citas a `MEMORY.md` y
    `ARCHITECTURE.md`, 6 risks accionables, y test_coverage
    preciso por fichero. Demo killer.

- *"Cursor optimiza el prompt. Karajan optimiza el resultado."*
  - Ya en el deck (slide 4). Sigue siendo válida.

- *"Karajan no es magia. Es un orquestador que pone disciplina
  donde la IA pone velocidad."*
  - Ya en el deck (slide 26 — closing). Sigue siendo válida.

## Insights de testing que pueden alimentar slides

### Comparativa "antes vs ahora" del Sonar token bootstrap (KJC-TSK-0367)

Antes (release v2.10.1):
1. Abrir `localhost:9000` en el navegador
2. Login admin/admin → Sonar fuerza cambio de password
3. My Account → Security → Generate Token
4. Copiar el token a `~/.karajan/kj.config.yml`
5. **~3 minutos manuales**

Ahora (v2.10.2 wizard):
- Una llamada REST → token persistido mode 0600 → **360 ms automáticos**

Slide candidate: tabla comparativa visual. Refuerza la narrativa de
"Karajan elimina la fricción de setup" sin ser una promesa abstracta.

### El demo de `kj researcher` es un slide killer en sí mismo

Si proyectas el JSON output crudo en una slide y lo lees en voz alta,
la audiencia entiende inmediatamente:

- No es un wrapper de Claude
- Razona sobre el código real (no abstracciones)
- Cita líneas concretas, ficheros concretos, decisiones históricas
  concretas
- Y detecta bugs latentes (en este caso un orden cuestionable de
  invariants vs Solomon suggestions)

**Sugerencia**: añadir 1 slide entre la 12 (context engineering) y
la 13 (más allá del CE) que sea SOLO el JSON del researcher con un
título de tipo "el researcher rol detecta esto en 90 segundos".

## Demo flow ajustado tras testing

### Demo agent-readiness (1 min) — sigue siendo el primer demo

Validado N1: `kj audit --agent-readiness --json | jq '.score'`
devuelve `100` directamente. Showstopper cerrado.

### Demo `kj run` happy-path (5-10 min) — pendiente de validar

Pendiente del Nivel 3 del plan de testing. Cuando lo ejecute
añado aquí timing real medido y cualquier ajuste necesario.

### NUEVO: Demo `kj researcher` para enseñar el JSON output

90 s de espera en directo es viable si lo planteamos como
"mientras procesa, os explico qué está haciendo": habla durante 90s
sobre la arquitectura mientras se ejecuta, y cuando termina el
output ya está. Es exactamente lo que hace una sesión de Karajan
real.

## Cosas a redirigir/cuidar

### Coste por demo

`kj researcher` con `claude-opus-4-7` cuesta ~30-50 cents por ejecución
(90s). Si en los ensayos lo lanzas 5-10 veces, son $2-5. Si en la
charla lo lanzas en directo, otro tanto. Total: presupuesto $10-15
para ensayos + charla. Asumible pero conviene saberlo.

**Mitigación**: configurar `--smart-models` para que researcher use
`sonnet` o incluso `haiku` cuando la pregunta es simple. Ahora
mismo está en opus por defecto. Investigar tras la charla.

### `kj triage` también usa opus

Anomalía detectada: una clasificación trivial de complejidad usa
`opus-4-7` (~5-15 cents). Debería usar `haiku` (sub-cent). El
model registry no está routeando óptimo. **Backlog**: card en PG
para revisar `--smart-models` post-talk.

## Cosas que NO meter en slides (pero sí mantener en mente)

- Bug silente del rotation de admin password en Sonar bootstrap
  (anotado en `TODO-post-talk.md`). No vender lo que no funciona
  100% end-to-end.
- `--bind 0.0.0.0` del HU Board: la cookie/auth para browser
  exterior está rota (P1-1 en `TODO-post-talk.md`). Demo en
  loopback únicamente; no enseñar la feature LAN aún.

## Cuándo revisar este fichero

- Tras terminar la batería de testing (Niveles 0-9 del plan).
- Antes de cada ensayo del deck (semana del 12 mayo).
- Día antes de la charla (20 mayo) para chequeo final.
