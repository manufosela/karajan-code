# Anexo — IA asistida en revisión y corrección de código

> Complemento al documento de *Estándares de desarrollo (controles, guardarraíles
> y hooks)*. Aquí se añade la capa **opcional** de IA. Regla de oro: la IA
> **asiste en revisar y corregir**, no reemplaza al desarrollador ni escribe la
> funcionalidad. **La persona es dueña del código y la única que aprueba y
> fusiona.** La IA propone; el humano dispone.

Estado: modelo/herramienta **por definir** (§A.8). Todo aquí es agnóstico de
proveedor: sirve igual con una API cloud, un modelo local/on-prem o un agente CLI.

---

## A.1 Principio y límites de rol

La IA entra **solo** en el bucle de revisión y saneo, nunca como origen de la
lógica de negocio.

| La IA **sí** hace | La IA **no** hace |
|-------------------|-------------------|
| Termina de revisar un diff que ya escribió una persona. | Escribir la feature desde cero. |
| Corregir feedback de linters/Sonar antes del PR. | Aprobar su propio trabajo. |
| Sugerir tests que faltan, casos borde, nombres. | Fusionar un PR o hacer push a la rama principal. |
| Redactar la descripción del PR a partir del diff. | Saltarse un gate de CI. |
| Comentar un PR (revisión *advisory*). | Decidir en solitario si algo se mergea. |

Corolario: **cada cambio propuesto por la IA pasa por revisión humana y por los
mismos gates que cualquier otro cambio** (formato, lint, tests, presupuesto de
LOC, convención de commits). La IA no tiene vía rápida.

---

## A.2 Dónde encaja en las cuatro capas

Sobre el modelo de capas del documento base (editor → pre-commit → CI → release),
la IA se inserta como una **capa 2.5**: después de los controles deterministas
locales y **antes** de abrir el PR.

    Editor
      → pre-commit (formato/lint/tests rápidos)   [determinista]
      → IA: revisión + saneo                       [asistida]
      → PR
      → CI                                         [determinista]
      → IA: review advisory                        [asistida]
      → humano aprueba y fusiona                   [decisión humana]

Motivo del orden: primero se agota lo **determinista y gratis** (el formateador y
el linter ya arreglan lo suyo), y la IA se reserva para lo que esas herramientas
**no** pueden resolver solas (§A.6).

---

## A.3 Casos de uso

| Caso | Entrada | Salida de la IA | Quién decide |
|------|---------|-----------------|--------------|
| **Auto-review pre-PR** | diff staged/de la rama | lista de bugs, smells, riesgos, tests que faltan | el dev acepta/descarta cada punto |
| **Saneo de feedback de análisis** | informe de Sonar/linter/typechecker | parche propuesto que resuelve cada issue | el dev revisa el parche antes de commitear |
| **Cobertura de casos borde** | función + su test | tests adicionales sugeridos | el dev los valida y ajusta |
| **Descripción de PR** | diff + commits | borrador del cuerpo del PR (qué/por qué) | el dev edita y publica |
| **Revisión de PR** | diff del PR | comentarios *advisory* en línea | el revisor humano aprueba |

---

## A.4 El flujo con IA (paso a paso)

1. El dev implementa el cambio (código suyo, no de la IA).
2. Corren los controles **deterministas** locales: formateador `--write`, linter
   `--fix`, tests. Se arregla todo lo autofixeable **sin** IA.
3. **Pase de IA de revisión/saneo**: se le pasa el diff + el feedback residual
   (lo que Sonar/linter/typechecker marcan y no se autofixea).
4. La IA devuelve **un parche propuesto y/o una lista de observaciones**.
5. **El dev revisa el parche** como revisaría el de un compañero: acepta lo
   correcto, descarta lo erróneo o alucinado, ajusta lo demás.
6. Se commitea (el dev, con su identidad; el commit sigue la convención) y se abre
   el PR.
7. CI corre todos los gates igual que siempre.
8. Opcional: **pase de IA de review sobre el PR** (comentarios *advisory*).
9. **Un humano aprueba y fusiona.** Nunca la IA.

---

## A.5 Guardarraíles obligatorios

Sin estos, la IA deja de ser una ayuda y se vuelve un riesgo:

- **La IA nunca fusiona ni aprueba.** El *approve* del PR es de una persona.
- **La IA nunca commitea directo a la rama principal.** Su salida entra por rama + PR.
- **Sin bypass de gates.** Un parche de IA pasa lint, tests, cobertura, presupuesto
  de LOC y validación de commit igual que uno humano.
- **Revisión humana obligatoria** de todo lo que produzca la IA antes de commitear.
  Tratar su salida como un PR de terceros: puede alucinar, romper o "arreglar"
  cambiando el comportamiento.
- **Advisory por defecto.** El comentario de la IA en un PR informa; no bloquea el
  merge por sí solo (a menos que el equipo decida explícitamente lo contrario para
  algún check concreto y determinista).
- **Trazabilidad**: registrar qué modelo/versión y (si aplica) qué prompt se usó,
  para poder reproducir y auditar. Nada de cajas negras sin rastro.
- **Determinista primero** (§A.6): no gastar IA en lo que una herramienta arregla sola.

---

## A.6 Determinista primero — no malgastar la IA

La IA es más cara, más lenta y menos fiable que un formateador. Antes de invocarla:

- Formateo → lo arregla el formateador (`--write`). **No** es trabajo de IA.
- Reglas de lint con autofix → `--fix`. **No** es trabajo de IA.
- Imports ordenados, comillas, punto y coma → determinista.

A la IA se le manda **solo el residuo**: lógica dudosa, un *code smell* de Sonar
que requiere reestructurar, un caso borde sin test, un nombre confuso, un posible
bug que el linter no ve. Enviar todo el ruido determinista a la IA es quemar
tokens y diluir su atención en lo que sí importa.

---

## A.7 Revisión de PRs con IA

- **Rol**: segundo par de ojos *advisory*, no *gatekeeper*.
- **Ámbito**: acotar al diff del PR (no a todo el repo) para respuestas útiles y baratas.
- **Salida**: comentarios concretos y accionables; el revisor humano decide cuáles
  aplicar y es quien finalmente aprueba.
- **No** convertir a la IA en aprobador automático ni en check bloqueante genérico:
  su falso-positivo/negativo no debe frenar ni colar un merge por sí solo.

---

## A.8 Selección de modelo/herramienta (por definir)

Aún sin decidir. Criterios para elegir cuando toque:

| Criterio | Qué mirar |
|----------|-----------|
| **Capacidad** | Calidad de razonamiento sobre código en los lenguajes del proyecto. |
| **Contexto** | Tamaño de ventana suficiente para diffs y ficheros reales. |
| **Coste** | Precio por revisión/PR; sostenible en el volumen esperado. |
| **Privacidad** | ¿API cloud, on-prem o local? ¿El código sale de la organización? (§A.9) |
| **Integración** | Encaja en el flujo (CLI, hook, acción de CI, bot de PR) sin fricción. |
| **Reproducibilidad** | Versionado del modelo; salidas trazables. |
| **Fallback** | Si el proveedor falla o agota cuota, el flujo sigue (degradar, no romper). |

Diseñar la integración **agnóstica de proveedor**: el modelo debe poder cambiarse
sin rehacer el flujo. Se puede empezar con un modelo y sustituirlo luego.

---

## A.9 Privacidad y seguridad al usar IA

- **No enviar secretos ni datos personales** a la IA: credenciales, API keys,
  ficheros de cuenta de servicio, PII. Sanear el contexto antes de mandarlo
  (mismo *boundary* de salida que para artefactos públicos).
- **Confidencialidad del código**: si el repo es privado, verificar la política de
  retención/entrenamiento del proveedor; preferir opciones sin retención o modelos
  locales cuando el código sea sensible.
- **Tratar la salida de la IA como no confiable**: no ejecutar comandos que
  proponga a ciegas; revisar los parches antes de aplicarlos.
- **Prompt injection**: si el diff o el input pueden contener instrucciones
  incrustadas, no dejar que la IA actúe sobre ellas sin filtro.

---

## A.10 Qué NO delegar en la IA

- Escribir la funcionalidad desde cero (fuera de alcance: la IA revisa/corrige, no crea).
- La decisión de merge o el *approve* del PR.
- Ser el único gate de calidad (los deterministas mandan; la IA complementa).
- Correcciones en caliente sobre la rama principal sin PR ni revisión.
- Aceptar su parche sin leerlo "porque compila".

---

## Checklist de adopción

- [ ] La IA está posicionada como asistente de revisión/corrección, no como autora.
- [ ] Los controles deterministas corren **antes** que la IA (§A.6).
- [ ] Todo parche de IA se revisa por una persona antes de commitear.
- [ ] La IA no aprueba, no mergea, no commitea a la rama principal.
- [ ] Los parches de IA pasan los mismos gates de CI que cualquier cambio.
- [ ] Review de PR con IA en modo *advisory*, con humano como aprobador.
- [ ] Sin secretos ni datos personales en el contexto enviado a la IA.
- [ ] Modelo/herramienta elegido con criterios de §A.8 y sustituible.
- [ ] Trazabilidad: se registra qué modelo/versión intervino.
