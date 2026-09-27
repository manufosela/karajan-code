# RAG por proyecto y board scoped: los datos de un proyecto no se mezclan con los de otro

Status: accepted
Date: 2026-09-27

## Context

El usuario no quiere ver todos los proyectos ni todos los RAGs en un solo sitio. Radiografia del codigo (27-sep-2026): ~/.karajan/rag.db es UNA base de 427 MB con 19 proyectos y 49.825 chunks en un indice vectorial sin particion; la KNN saca los 10 vecinos de toda la maquina y filtra por proyecto DESPUES, asi que un proyecto pequeno puede recibir 0 resultados con el chunk perfecto indexado (karajan-code es el 46 por ciento del corpus). Cinco consultas no filtran por proyecto, una de ellas el preload que entra en el prompt del coder. No hay cache de embeddings compartida: partir no recomputa nada. El board es un daemon por maquina con PID unico que ata config, terminal y planes compartidos a su propio cwd; el front ya tiene un scoped-mode por URL (/p/slug) que nadie usa. N boards por proceso costarian 50-80 MB cada uno mas un reaper por proceso y un registro de instancias, y no resuelven nada que no resuelva scoped mas identidad del proyecto en cada peticion. Sonar es el precedente: un servidor, muchos proyectos, la identidad viaja con la peticion.

## Decision

RAG por proyecto: .karajan/rag.db dentro de cada repo como ruta por defecto (KJ_RAG_DB sigue mandando), el corpus library en su propia DB global, el embedder compartido, y el MCP y el watcher resuelven la DB desde el proyecto. Migracion: reindexar. Board scoped: UNA instancia por maquina como Sonar, arrancada sola (auto_start ON) por el primer kj que la necesite, y cada proyecto abre su vista /p/slug con el resto oculto; la identidad del proyecto viaja en cada peticion (config, terminal, rag del board) y nunca en el cwd del daemon; el dashboard global queda en / como opcion explicita. NO se hace un board por proceso.

## Consequences

Cada proyecto reindexa lo suyo una vez (ya se embebia por proyecto: coste cero de recomputo). Sube el recall del RAG al desaparecer el post-filtro. Cinco fugas cross-project se cierran sin tocar sus call sites. El dashboard multiproyecto sobrevive como opcion, no como puerta de entrada. Un proyecto puede elegir embedder y dim distintos. Un rm -rf del proyecto se lleva su indice. Queda una sola cache hu-board.db reconstruible por maquina; los reapers no se duplican. Se pierde la posibilidad de aislar PROCESOS entre proyectos, que nadie pidio.
