---
title: Gobernanza
description: Policy como código, excepciones que caducan, un registro de decisiones que puedes verificar y un bloqueo de identidad. Qué impone Karajan y dónde.
---

Los [gates](/docs/es/v4/gates/) comprueban cada cambio. La gobernanza decide qué puede hacer un agente, registra cada decisión que toma y mantiene las excepciones a la vista. Se apoya en tres cosas:

- una **policy**, escrita como código y trackeada en git;
- las **decisiones**, selladas una tras otra en una cadena de hashes;
- las **excepciones**, cada una con nombre, motivo y fecha de caducidad.

## La policy: `.karajan/policy.yml`

La policy es un fichero YAML de tu repo. Su vocabulario es cerrado: el motor solo acepta lo que sabe aplicar.

```yaml
version: 1
roles:
  coder:
    write:
      deny: ["infra/**", ".github/**"]
      enforcement: deny
    shell:
      deny: ["git push*", "curl *"]
invariants:
  - id: loc-budget
    kind: diff-threshold
    metric: net_lines_added
    max: 200
    enforcement: warn
```

- Los **roles** (`coder`, `reviewer`...) tienen dos capacidades: `write` (globs de ficheros) y `shell` (patrones de comando, que se comparan desde el principio del comando; `*` es cualquier cosa).
- Cada capacidad admite listas `allow` y `deny`. Deny gana a allow, y una lista `allow` convierte en denegación todo lo que queda fuera.
- `enforcement` es `warn` (por defecto) o `deny`. `class: security` marca una regla que ninguna excepción ni ningún arbitraje puede levantar.
- Los **invariantes** miran el diff entero. Hoy hay un tipo: `diff-threshold` sobre `net_lines_added`.

Un rol, una capacidad, una clave o un valor que el motor no conoce es un error de carga, nunca un valor por defecto silencioso: `kj policy` sale con 1, el gate de commit falla con `policy.load` y el Sentinel deniega hasta que se arregla el fichero.

No hace falta aprender el vocabulario para escribir una regla. Dila con tus palabras:

```sh
kj policy add "el coder no puede tocar la carpeta infra"
# propone el diff de policy.yml; no escribe nada sin --yes
```

## Dónde se aplica: tres niveles

La misma policy se comprueba en hasta tres momentos. Cuáles tienes depende de tu anfitrión y de tu CI.

| Nivel | Cuándo | Requiere | Qué garantiza |
| --- | --- | --- | --- |
| A | Al usar una herramienta | Claude Code como anfitrión, con los hooks de Karajan | El Sentinel ejecuta `kj policy eval --strict` en cada llamada a una herramienta y para la acción prohibida antes de que ocurra. |
| B | Al commitear | Cualquier anfitrión | `kj review --staged` y el hook pre-commit comprueban el diff preparado. Un commit que rompe una regla `deny` no entra. |
| C | Al mergear | GitHub Actions, sembrado por `kj harden` | El workflow `kj-policy.yml` ejecuta `kj policy check --range --strict` en la pull request. Una violación bloquea el merge. |

El nivel B es el suelo: se cumple con cualquier anfitrión. Las reglas de seguridad no admiten excepción en ningún nivel. `kj doctor` te dice qué niveles están activos en tu repo.

Puedes lanzar las mismas comprobaciones a mano:

```sh
kj policy check                          # el diff preparado; por defecto solo avisa
kj policy check --range main...HEAD --strict   # lo que ejecuta la CI: exit 2 si hay un deny
kj policy eval --tool Write --input '{"file_path":"infra/main.tf"}'   # una llamada: {decision, rule_id, reason}
```

`kj policy eval` es el contrato para los adaptadores de hooks: cualquier anfitrión que pueda ejecutar un comando antes de usar una herramienta puede usarlo.

## Excepciones que caducan

A veces una regla tiene que ceder durante un tiempo. `kj policy grant` lo deja escrito, a la vista:

```sh
kj policy grant --rule roles.coder.write.deny \
  --until 2026-12-01T00:00:00Z \
  --reason "los scripts de despliegue pasan a infra/ en este sprint"
```

- Los tres parámetros son obligatorios y `--until` es una fecha ISO-8601 estricta. Cuando pasa, el gate deja de aplicar la excepción por sí solo.
- No se pueden conceder excepciones a reglas de seguridad ni a los valores por defecto de Karajan, y no se puede conceder nada mientras el fichero de policy sea inválido.
- Las concesiones se añaden a `.karajan/policy-exceptions.jsonl`. Con `--global` van a `~/.karajan` y valen para todos los proyectos de tu máquina.
- Cada concesión registra quién la hizo, a partir de tu usuario de git y del sistema. Esa identidad es declarada, no autenticada: el registro dice quién dijo que la concedía.

**Renovar es una señal.** A partir de la segunda concesión sobre la misma regla, kj avisa de que una excepción que se renueva ya no es una excepción: o la regla está mal, o el trabajo. `kj policy report` también la señala.

## El registro de decisiones

Cada deny, cada exención y el allow de cada commit se escriben en `.karajan/policy-decisions.jsonl`. Cada entrada lleva el sha256 de la anterior, el hash de la policy y el hash de lo que se decidió, así que cambiar o borrar una entrada pasada rompe la cadena.

```sh
kj policy report    # avisos, denegaciones y exenciones por regla, denegaciones abiertas,
                    # concesiones vivas / a punto de caducar / caducadas, y las señales
kj policy anchor    # verifica la cadena y sella su cabeza en .karajan/policy-anchor.json
```

El registro se queda en tu máquina. El ancla se trackea en git, así que cada commit del ancla fija el estado de la cadena en la historia del repo: un registro reescrito después ya no coincide con ella. Con la cadena rota, `kj policy report` dice dónde se rompe y sale con 1, y `kj policy anchor` se niega a sellarla.

## El bloqueo de identidad

Mucha gente trabaja con más de una cuenta de GitHub. El bloqueo de identidad ata cada clon a una:

```sh
kj identity set     # declara la cuenta de gh y el email de git de este clon
kj identity show    # declarada frente a activa; exit 2 si no coinciden o no hay ninguna declarada
```

La declaración vive en `.karajan/identity.local.yml` y nunca se trackea. Con ella:

- el Sentinel para `gh` (y los envoltorios por cuenta, como `gh-<cuenta>`) cuando no hay identidad declarada o la cuenta activa no es la declarada;
- el hook pre-commit comprueba el email del autor y del committer;
- el hook pre-push comprueba cada commit que va a enviar.

No hay escape: si la identidad está mal, se cambia de cuenta, no el bloqueo.

## El núcleo: `@karajan-family/governance`

El motor que hay detrás es un paquete propio de la familia Karajan. Conoce tres cosas, Policy, Decision y Exception, y nada de git, de diffs ni de las herramientas de ningún agente: interpreta la policy, evalúa escrituras y comandos, comprueba artefactos, registra decisiones y excepciones y verifica la cadena. No hace entrada ni salida y no llama a ningún modelo, así que la misma policy da siempre la misma respuesta. Karajan Code es su primer consumidor, no su dueño.

## Ver también

- [Los gates](/docs/es/v4/gates/): el gate de revisión y los demás gates de git.
- [El Sentinel](/docs/es/guides/sentinel/): qué para al usar herramientas, y por qué.
- [Blindar frente a IA](/docs/es/guides/hardening-against-ai/): lo que un agente no puede debilitar.
