# Identity lock: identidad por clon, local y sin trackear, fail-closed en los gates, sin auto-switch

Status: accepted
Date: 2026-08-20

## Context

Incidente 2026-08-20: un gh issue comment sin switch explicito salio como la cuenta de cliente en el repo publico de karajan; la regla del switch vivia en la memoria del agente y una regla en memoria se salta y cuesta tokens. Ademas el keyring de gh lo cambian otras sesiones por debajo: el primer kj identity set --yes ato el clon a la cuenta equivocada.

## Decision

Cada CLON declara su identidad (gh_user y git_email) en .karajan identity.local.yml, por desarrollador y nunca trackeado; se captura al arrancar SOLO con confirmacion humana (en no-TTY se declara pendiente, jamas se ata a ciegas) o con flags explicitos. Los gates (Sentinel tool-time, hooks commit-time) comparan lo declarado con lo efectivo y DENIEGAN con el remedio literal; nunca auto-switch: cambiar el keyring es acto del usuario. Sin identidad declarada el Sentinel es fail-closed para gh y git mutadores.

## Consequences

Un clon nuevo no puede escribir en el repo ni en el tracker hasta declarar identidad (friccion asumida, una vez por clon). La deteccion lee el hosts.yml de gh sin red: si gh cambia el formato, el detector devuelve null y el gate deniega pidiendo kj identity set (fail-closed, nunca adivina). Identidades de npm y firebase quedan fuera hasta que se pidan.
