# karajan-family pasa de cuenta de usuario a organizacion de npm

Status: accepted
Date: 2026-10-25
Accepted: 2026-10-25 (dev_001), en la conversación de la sesión: «Pues vamos a crear la organización»

## Context

karajan-family es una cuenta de usuario de npm (no una organizacion): solo ella puede dar de alta paquetes nuevos en el scope, y su 2FA es una passkey del navegador. El 24-oct-2026 el alta de @karajan-family/atril 1.0.0 fallo: dos accesos con codigo de recuperacion (la passkey no respondia) dispararon la retencion de seguridad de 72 horas de npm, y mientras dura no se publica ni se crean tokens. En agosto se descarto convertirla porque la conversion exige crear otra cuenta de usuario.

## Decision

Convertir la cuenta karajan-family en organizacion de npm con el mismo nombre (plan gratuito, paquetes publicos ilimitados). La conversion crea una cuenta de usuario nueva que queda como propietaria; manufosela se anade como propietario y es quien publica en el dia a dia; Jorge del Casar entra como miembro en un equipo con escritura sobre @karajan-family/atril. Descartadas: seguir como cuenta de usuario (cada alta depende de entrar con karajan-family y su passkey) y publicar clones sin scope (karajan-atril), que habria que mantener o deprecar sin usuarios que migrar (ADR 0004).

## Consequences

Hecha el 25-oct-2026 por el usuario desde la web, sin que la retención de 72 horas la bloqueara: la propietaria nueva es la cuenta karajan-developer, con 2FA, y la organización nace con el equipo Developers (todo miembro nuevo entra en él y tiene lectura y escritura sobre los paquetes nuevos del scope). Ya no se puede entrar con la cuenta karajan-family; la cuenta propietaria nueva queda de respaldo con su email y su 2FA. npm no documenta que se pueda deshacer: se trata como irreversible. Los paquetes y permisos actuales se transfieren a la organizacion; los miembros se gestionan por equipos, sin compartir cuentas. Las altas de paquetes nuevos del scope las hace manufosela con su sesion. La conversion invalida las sesiones de npm abiertas con la cuenta antigua (401 en `npm whoami`).
