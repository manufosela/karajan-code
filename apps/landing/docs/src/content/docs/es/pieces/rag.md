---
title: El RAG del proyecto
description: La memoria del proyecto, un índice al que tu agente pregunta antes de suponer. Qué es, por qué existe, cuándo actúa, cómo se usa y qué no hace.
---

## Qué es

El RAG del proyecto es un índice de búsqueda de tu repositorio. Tu agente le pregunta con palabras normales ("¿dónde se guarda el veredicto de la revisión?") y recibe los ficheros y fragmentos que lo responden. Vive en tu proyecto, en `.karajan/rag.db`: un índice por proyecto.

Indexa lo que lista git (los ficheros versionados y los no versionados que no están ignorados) y deja fuera lo que no debe estar en un índice: lo que nombran `rag.exclude` y `.ragignore`, los ficheros que pueden guardar secretos (`.env`, claves), los lockfiles, los minificados, los mapas, los snapshots, los binarios y los ficheros de más de 512 KB.

## Por qué existe

Un agente que no sabe dónde vive algo lo adivina, y en un código grande la adivinanza suele caer en el primer fichero que parece el bueno. El gemelo que no miró, la misma idea implementada otra vez tres carpetas más allá, es de donde sale el siguiente bug.

Por eso el método es: pregunta antes de suponer. El RAG responde con lo que el código es hoy de verdad, no con lo que el agente recuerda o se imagina.

## Cuándo actúa

| Momento | Qué pasa |
|---|---|
| **El agente pregunta** | `kj rag query "<pregunta>"`, o la herramienta `kj_rag_query` en Claude Code. Antes de cada consulta, kj reindexa los ficheros que han cambiado (hasta 25 por defecto). |
| **Antes de una edición** | El Sentinel solo deja editar un fichero de código si alguna consulta de la sesión ha devuelto ese fichero o uno de su carpeta. Si el fichero no está en el índice, kj lo indexa en el momento y aun así pide la consulta. |
| **En la revisión** | `kj review` comprueba que las consultas de la sesión cubrieron cada fichero de código del diff. Los ficheros que devolvieron esas consultas y que el diff no toca le llegan al revisor por su nombre: el cambio puede estar incompleto. |

Lo que preguntó la sesión y lo que volvió queda apuntado en el [ledger](/docs/es/pieces/ledger/), así que los gates comprueban un hecho, no la palabra del agente.

## Cómo se usa

- `kj rag index` construye el índice. `kj env install` lo hace por ti si no hay ninguno.
- `kj rag query "<pregunta>"` le pregunta. `--scope code|plans|onboarding|all` acota dónde busca y `--top-k` cuántas respuestas da.
- En Claude Code, `kj env install` registra el RAG como servidor MCP en tu configuración personal (nunca en el `.mcp.json` compartido), así que el agente tiene `kj_rag_query` como herramienta propia.
- Para dejar algo fuera, añádelo a `.ragignore` o a `rag.exclude`. Eso es configuración de gobierno: la cambias tú, el agente no puede.

## Qué no hace

- **No sale de tu máquina, por defecto.** El índice es un fichero local y el embedder por defecto es local (ollama u onnx). Un embedder en la nube (OpenAI, Voyage, Cohere, Mistral) está bloqueado salvo que declares `rag.sensitivity: public`; entonces el código indexado y las consultas sí van a ese proveedor, con los datos personales tachados antes.
- **No indexa secretos a propósito,** y lo que excluyes se queda fuera.
- **No prueba que el código esté bien.** Dice dónde están las cosas; si el cambio es correcto lo deciden los [controles de calidad](/docs/es/pieces/quality/) y la [revisión cruzada](/docs/es/pieces/cross-review/).
- **Un índice vacío no es una respuesta.** kj lo dice y da el remedio, en vez de dejar que el agente lea el silencio como "no hay nada".
