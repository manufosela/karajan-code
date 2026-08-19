# Migración al scope @karajan-family: dual-publish y deprecate

Status: accepted
Date: 2026-08-19

## Context

La familia publica con nombres npm dispersos (karajan-code, karajan-core) y el kernel ya nació bajo el scope (@karajan-family/governance). El usuario decidió (PRP-0018, 2026-08-19) que todo pase bajo el paraguas @karajan-family: con la adopción actual el coste de migrar naming es ~cero y solo crece con cada usuario nuevo. Restricción: no romper a NADIE — ni a la base instalada ni al auto-update del nombre viejo.

## Decision

Solo cambian las coordenadas npm: el producto sigue siendo Karajan Code, el binario kj, el repo GitHub el mismo. Mapa: karajan-code → @karajan-family/code; karajan-core → @karajan-family/core; rag/watch/hu-board cuando toque. Mecánica en tres tiempos: (1) DUAL-PUBLISH durante 2-3 minors — la misma release publica ambos nombres con contenido idéntico (scripts/dual-publish.mjs: swap del name EN SITIO con restauración en finally, jamás renombra a ciegas, y verificación con el MISMO verify-pack name-agnóstico); (2) el onboarding público enseña el scoped como primario con nota del legacy; (3) npm deprecate del viejo con mensaje-puntero — decisión explícita del usuario, jamás automática, y el nombre viejo no se borra nunca (npm no permite reutilizarlo y sirve de señal). Prerequisito ejecutado (MIG-A parte 1): ninguna ruta crítica de kj depende del literal de su nombre — update-check, verify-pack y la plantilla del workflow de policy lo resuelven del manifest (URLs del registro codificadas: el scoped lleva @ y /), fijado por test de arquitectura. Identidad: el PRIMER publish de cada nombre nuevo del scope lo hace el usuario (cuenta karajan-family, 2FA security key, desde su terminal) y acto seguido owner add manufosela; el día a día sigue con la cuenta de siempre.

## Consequences

Positivas: la adopción nueva entra por el scope sin que la base instalada note nada; el mismo tarball E2E-verificado para ambos nombres; el patrón queda listo para core y el resto de la familia. Aceptadas: doble publish por release durante la transición (dos OTP-flujos); el bin `kj` colisiona si alguien instala AMBOS nombres en global (documentado: instala uno); alias-package descartado (los alias con bin colisionan y deprecate ya da la señal); renombrar sin dual descartado (rompería el auto-update del nombre viejo). MIG-C (deprecate) queda bloqueada por tiempo: 2-3 minors duales sin incidencias y el OK del usuario.
