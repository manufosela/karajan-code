# Política de seguridad

Karajan RAG está en **fase de desarrollo temprano** (pre-1.0). Apreciamos
cualquier reporte responsable de vulnerabilidades.

## Versiones soportadas

| Versión | Soporte de seguridad |
|---------|----------------------|
| 0.1.x   | ✅ (activo)          |
| < 0.1   | ❌                   |

## Cómo reportar una vulnerabilidad

**No abras issues públicos con detalles explotables.** En su lugar:

1. Envía un email a **mjfosela@gmail.com** con:
   - Descripción del problema y vector de explotación.
   - Pasos reproducibles (commit hash, comandos).
   - Impacto estimado (confidencialidad / integridad / disponibilidad).
   - Tu PGP key si quieres respuesta cifrada (opcional).

2. **SLA de respuesta**: esperamos responder en un plazo de **72 horas** con
   acuse de recibo. Una evaluación inicial (severidad, plan) llegará en los
   **7 días** siguientes.

3. **Divulgación coordinada**: trabajamos el fix en privado hasta publicar
   un patch. Publicaremos un aviso después con créditos al reportero (salvo
   preferencia de anonimato).

## Alcance

- Bugs de seguridad en el código del orquestador (inyección, SSRF, XXE,
  deserialización insegura, exposición de secretos, etc.).
- Políticas de sensibilidad que permitan filtrar datos a proveedores no
  autorizados.
- PII que escape al redactor sin razón técnica clara.

## Fuera de alcance

- Vulnerabilidades en los CLIs de terceros (Claude, Codex, Gemini, Ollama).
  Reporta a sus respectivos vendors.
- DoS por mal uso del orquestador (p.ej. pipelines que consumen recursos
  desmesurados) — son cuestiones de diseño, no vulnerabilidad.
- Dependencias transitivas con CVEs conocidos sin PoC de explotación
  en el contexto de KJR.

## Reconocimientos

Incluiremos a los reporteros en `CHANGELOG.md` bajo la sección de seguridad
del release correspondiente, siempre que autoricen.
