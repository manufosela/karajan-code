# Estrategias de chunking en Karajan RAG

Karajan RAG ofrece varias estrategias para trocear documentos:

- **fixed-size**: chunks de tamaño fijo con overlap configurable. Baseline rápido.
- **por separadores**: respeta párrafos, frases y espacios en orden jerárquico.
- **por tokens**: estima tokens con heurística length/4 y calibra al contexto del LLM.
- **por headings Markdown**: usa los headings # / ## / ### como cortes naturales y guarda el heading path en metadata.

La elección del chunker afecta directamente a la calidad del retrieval: chunks más pequeños dan retrievals más precisos pero fragmentan el significado; chunks grandes preservan contexto pero introducen ruido.
