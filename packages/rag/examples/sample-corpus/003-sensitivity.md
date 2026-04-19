# Políticas de sensibilidad y on-premise

Karajan RAG etiqueta cada Document y Chunk con una sensibilidad: public, internal o confidential. El motor de policy (SensitivityPolicy) enruta cada invocación al adapter CLI permitido por la sensibilidad del input.

Por defecto:
- confidential → solo Ollama on-premise.
- internal → Ollama u otros proveedores con garantía de no-training.
- public → Claude, Codex o Gemini públicos.

Además, el RedactionRole aplica un redactor PII basado en regex (email, teléfono, NIF, NIE, tarjeta de crédito) antes de enviar cualquier chunk al LLM, como defensa en profundidad.
