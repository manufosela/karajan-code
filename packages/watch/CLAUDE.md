# karajan-watch — contexto del proyecto

Producto de la familia Karajan: observa merges en los repos de una
organización, mantiene un RAG compartido (código + docs) siempre fresco
vía karajan-rag, y produce análisis de impacto cross-repo y avisos de
documentación desactualizada.

**LEE PRIMERO [docs/design.md](./docs/design.md)** — es el contrato de
contexto: arquitectura de tres capas, componentes, fases y decisiones
abiertas. Este fichero solo resume las reglas de operación.

## Identidad y gestión

- Proyecto **personal y open source** de @manufosela (como karajan-rag).
  Identidad git/gh/npm: SIEMPRE manufosela. Nunca cuentas corporativas.
- Planning Game: proyecto **"Karajan Watch" (KJW)** en la instancia
  `planning-game-personal`. Sin card no se codifica (regla global).
- Los despliegues concretos de organizaciones viven en
  SUS repos privados, en SUS orgs, con SU identidad — aquí jamás entra
  un dato de una organización concreta.

## Reglas duras

- **Motor = karajan-rag** (dependencia). Lo genérico de RAG se propone
  upstream, no se reimplementa aquí. Este repo es orquestación.
- **Sensibilidad primero**: embedders locales en ingesta; juicios LLM
  solo por adapters permitidos por la policy; redactPII en toda salida.
  Sin fallbacks silenciosos: ingesta que no indexa = job rojo.
- **Repo público**: grep de privacidad antes de cada commit — cero
  emails personales, cero referencias a repos/organizaciones privadas.
- **Impacto = ranking con evidencia**, nunca "probabilidad" calibrada.
  No prometer lo que la similitud vectorial no da.
- Desarrollo bajo el **método karajan-code** (este repo tiene kj
  activado): RAG before assuming, card first, tests first, review
  cross-AI antes de cada commit. Respeta el bloque del método que kj
  mantiene más abajo en este fichero / en los rules files.

## Stack

Node.js >= 18, ESM, @ts-check con JSDoc (sin TypeScript compilado),
node:test, cero dependencias runtime salvo karajan-rag. Convenciones de
código idénticas a karajan-rag.
