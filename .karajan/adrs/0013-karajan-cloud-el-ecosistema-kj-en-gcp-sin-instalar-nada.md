# Karajan Cloud: el ecosistema kj en GCP para un equipo, sin instalar nada

Status: proposed
Date: 2026-09-28

## Context

Pedido del usuario el 28-sep-2026: que el equipo de Tribbu (varios usuarios) use Karajan sin instalar nada en su equipo. Un entorno controlado, levantado con Terraform en GCP, al que se entra con la cuenta de Google de Tribbu, que traiga todo el ecosistema (kj, claude, codex, gemini, git, Node, Ollama para los embeddings, Sonar, el board) y un chat que dirija al agente anfitrión, que a su vez lance `claude -p`, `codex` y `gemini`.

Hoy kj se instala por máquina, con sus dependencias (Ollama, Docker para Sonar, los CLIs de IA con su login). Para un equipo eso es trabajo repetido y entornos que divergen.

## Decision

Un nuevo miembro de la familia, `packages/cloud` en el monorepo, publicado como `@karajan-family/cloud`, con:

- **Una imagen del entorno** con todo el ecosistema instalado y sin secretos dentro.
- **Terraform de Cloud Workstations**: un entorno por usuario con disco persistente, acceso solo para cuentas del dominio de Tribbu vía la identidad de Google, secretos en Secret Manager.
- **Un chat web** que dirige al agente anfitrión, reutilizando la ventana única del board (su terminal integrada), con el método y el Sentinel activos igual que en local.

Se elige Cloud Workstations frente a montar GKE con un pod por usuario (más piezas propias que mantener: aislamiento, persistencia, acceso) y frente a Cloud Run (pensado para peticiones cortas, no para sesiones largas con disco).

## Pendiente antes de aceptar

1. El proyecto de GCP y la cuenta de facturación (a cargo del usuario).
2. Cómo se autentican los CLIs de IA en la nube: login por suscripción aislado por usuario, o claves de API de Tribbu, revisando los términos de uso de cada proveedor (KJC-TSK-0904).

## Consequences

Nadie del equipo instala nada y todos trabajan sobre el mismo entorno versionado. Aparece un coste de nube por usuario y por uso de modelos. La seguridad pasa a depender también del aislamiento entre entornos y de la gestión de secretos en GCP. El kj local sigue igual; la nube es otra forma de ejecutarlo, no un sustituto.
