<!--
Gracias por contribuir a Karajan RAG. Lee CONTRIBUTING.md antes de abrir el PR.
Las PRs deberían ser atómicas (<300 líneas ideal) y tener un único propósito.
-->

## Card ID

<!-- Formato obligatorio: KJR-TSK-XXXX o KJR-BUG-XXXX. Si no tienes acceso al Planning Game, abre un issue primero. -->

KJR-TSK-XXXX

## Resumen

<!-- ¿Qué cambia y por qué? Enfócate en el *por qué*, el diff ya cuenta el *qué*. -->

## Cambios

- <!-- punto 1 -->
- <!-- punto 2 -->

## Checklist

- [ ] `pnpm test` pasa en local (Node 20 + Node 22 si aplica)
- [ ] `pnpm lint` sin errores
- [ ] Si añade funcionalidad, incluye tests (`node:test`)
- [ ] Cobertura mantiene el umbral del 80%
- [ ] CHANGELOG.md actualizado bajo `[Unreleased]` si el cambio es visible al usuario
- [ ] ADR nuevo (o actualización) si cambia algo arquitectónico transversal
- [ ] Documentación (`README.md`, `docs/*`) actualizada si es relevante
- [ ] No introduce dependencias runtime sin justificar en el PR
- [ ] No incluye referencias a herramientas de IA generativa en commits ni en la descripción
- [ ] Confirmo que mi código se licencia como AGPL-3.0-or-later

## Sensibilidad / privacidad

<!-- Solo si toca policy, redactor o adapters de proveedor. -->

- [ ] No afecta a la lógica de sensitivity policy ni al redactor PII
- [ ] Afecta — he verificado que datos `confidential` siguen restringidos a `ollama`
- [ ] Afecta — he añadido tests que cubren el nuevo routing

## Notas para el reviewer

<!-- Opcional: contexto, decisiones descartadas, seguimiento, breaking changes. -->
