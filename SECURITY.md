# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in karajan-code, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. Email **mjfosela@gmail.com** with the subject line: `[SECURITY] karajan-code vulnerability report`
2. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment** within 48 hours
- **Assessment** within 7 days
- **Fix or mitigation** within 30 days for confirmed vulnerabilities
- Credit in the release notes (unless you prefer anonymity)

### Scope

The following are in scope:
- Command injection via task descriptions or config values
- Arbitrary file read/write outside the project directory
- Credential leakage (API keys, tokens) in logs or reports
- MCP server vulnerabilities (unauthorized tool execution)

The following are out of scope:
- Vulnerabilities in third-party AI CLIs (claude, codex, gemini, aider)
- SonarQube Docker container security (report to SonarSource)
- Denial of service via resource exhaustion (long-running tasks)

---

# Politica de Seguridad

## Versiones Soportadas

| Version | Soportada          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reportar una Vulnerabilidad

Si descubres una vulnerabilidad de seguridad en karajan-code, reportala de forma responsable.

**NO abras un issue publico en GitHub para vulnerabilidades de seguridad.**

### Como Reportar

1. Envia un email a **mjfosela@gmail.com** con el asunto: `[SECURITY] karajan-code vulnerability report`
2. Incluye:
   - Descripcion de la vulnerabilidad
   - Pasos para reproducirla
   - Impacto potencial
   - Solucion sugerida (si la tienes)

### Que Esperar

- **Confirmacion** en 48 horas
- **Evaluacion** en 7 dias
- **Correccion o mitigacion** en 30 dias para vulnerabilidades confirmadas
- Credito en las release notes (salvo que prefieras anonimato)

### Alcance

Dentro del alcance:
- Inyeccion de comandos via descripciones de tareas o valores de configuracion
- Lectura/escritura arbitraria de ficheros fuera del directorio del proyecto
- Fuga de credenciales (API keys, tokens) en logs o informes
- Vulnerabilidades del servidor MCP (ejecucion no autorizada de herramientas)

Fuera del alcance:
- Vulnerabilidades en CLIs de IA de terceros (claude, codex, gemini, aider)
- Seguridad del contenedor Docker de SonarQube (reportar a SonarSource)
- Denegacion de servicio por agotamiento de recursos (tareas de larga duracion)
