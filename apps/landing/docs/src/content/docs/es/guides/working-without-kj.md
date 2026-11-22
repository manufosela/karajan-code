---
title: Trabajar sin kj
description: Cómo contribuir a un repo que kj gobierna sin usar kj, y cómo la review automática de IA ocupa el lugar de kj review.
---

Usar kj es decisión de cada persona. Las reglas del repo obligan a todos y la CI las hace cumplir. Esta guía dice qué pide la CI a quien no usa kj y cómo la review automática de IA de un repo cuenta como la review cruzada.

## Qué pide la CI a todos

- El cambio es una PR pequeña y atómica, con sus tests, y la suite está en verde.
- Toda PR recibe una review cruzada de IA, atada al último commit de la PR.
- **Con kj**: `kj review --staged` antes de cada commit y después `kj review --publish-pr <n>`. La CI ejecuta `kj review --verify-pr <n>`.
- **Sin kj**: una review automática de IA sobre la PR, escrita por un bot que kj puede verificar por su login (`github-actions[bot]`). La misma comprobación, `kj review --verify-pr <n> --automatic-review codex-state`, la cuenta.
- Una review manual o un "Approve" normal de GitHub no cuentan: nada prueba qué miraron.

## Cómo cuenta la review automática de IA

Cuando una PR no tiene review de kj, kj busca la review automática del repo. Solo cuenta si se cumple todo esto:

- Se lee el **último** comentario de `github-actions[bot]` que lleva la marca de ciclo de vida. Los anteriores no importan.
- Su recomendación es `APPROVE`.
- `reviewed.head` y `observedHead` del comentario son ambos el head actual de la PR. Un push nuevo deja la review anterior obsoleta hasta que el bot revise de nuevo.
- Ningún hallazgo tiene el estado `active`. Arréglalo y deja que el bot revise otra vez.
- Un hallazgo `dismissed` solo cuenta si es `MINOR` y `dismissal.by` es alguien que no es el autor de la PR y tiene permiso de escritura en el repo.
- Los hallazgos `CRITICAL` y `MAJOR` nunca se pueden descartar: hay que arreglarlos.
- Una PR que cambia `.github/workflows/` nunca cuenta, porque un workflow que traiga podría escribir el comentario del bot. Para esa PR hace falta una review de kj.
- Una PR cuyos ficheros cambiados `gh` no puede listar enteros nunca cuenta.

Si algo falla, `kj review --verify-pr` imprime cada problema, así que sabes qué arreglar.

## Para quien mantiene el repo: declararla

En `.karajan/kj.config.yml`:

```yaml
review:
  automatic: codex-state
```

Después ejecuta `kj harden` y sella. El `kj-verdicts.yml` que escribe ejecuta `kj review --verify-pr <n> --automatic-review codex-state --wait-automatic 20`: la comprobación espera hasta 20 minutos a que el bot revise el head de la PR y consulta cada 30 segundos. Un push nuevo cancela la espera anterior y empieza otra. Necesita kj 5.35.0.

## El formato que kj lee (codex-state)

El comentario del bot tiene que tener exactamente esta forma. Cualquier otra cosa falla cerrada: la review no cuenta.

- La primera línea es `<!-- codex-review-lifecycle:v1 -->`.
- Exactamente una línea es `**Recommendation: APPROVE**` o `**Recommendation: REQUEST_CHANGES**`.
- La última línea es `<!-- codex-state:<base64 de un JSON> -->`, exactamente una vez.
- El JSON lleva las cadenas `status`, `reviewed.head`, `reviewed.base` y `observedHead`, y el array `findings[]`.
- Cada hallazgo lleva `id`, `severity` (`CRITICAL`, `MAJOR` o `MINOR`), `status` (`active`, `fixed` o `dismissed`), `path` y `line`. Uno descartado lleva además `dismissal.by`.

## Montar el bot en un repo que no lo tiene

Pega esto en tu agente de código (Claude Code, Codex, Cursor, VS Code):

```text
Monta una review automática de IA para este repo, en el formato que kj lee.

Crea un workflow de GitHub Actions que, en cada push a una pull request, ejecute una review de IA del diff de la PR con el secreto del proveedor de IA propio de este repo, y publique o actualice UN solo comentario fijo como github-actions[bot] con exactamente este formato:

- Primera línea: <!-- codex-review-lifecycle:v1 -->
- Exactamente una línea: **Recommendation: APPROVE** o **Recommendation: REQUEST_CHANGES**
- Última línea, exactamente una vez: <!-- codex-state:BASE64 --> donde BASE64 es el base64 de un objeto JSON con las cadenas status, reviewed.head, reviewed.base y observedHead, y el array findings. Cada hallazgo lleva id, severity (CRITICAL, MAJOR o MINOR), status (active, fixed o dismissed), path y line. Un hallazgo descartado lleva además dismissal.by.

Reglas del workflow:
- Revisa de nuevo en cada head nuevo: reviewed.head y observedHead son el sha del head de la PR.
- Cuando un hallazgo de una review anterior ya no está, márcalo como fixed. Mantén estables los ids.
- Trata todo hallazgo de seguridad como CRITICAL.
- Recomienda APPROVE solo cuando ningún hallazgo esté active.
- Nunca ejecutes el workflow con secretos sobre código de forks: usa pull_request solo en ramas del mismo repo y omite los forks.
- El comentario no debe citar texto que pueda contener las marcas.

Después decláralo en .karajan/kj.config.yml con review: { automatic: codex-state } y dime que ejecute kj harden, para que la comprobación de la CI espere al bot.
```

El agente escribe el workflow y la línea de configuración. Tú ejecutas `kj harden` y el sello.
