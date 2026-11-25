---
title: Troubleshooting y FAQ
description: Problemas comunes, soluciones y preguntas frecuentes sobre Karajan Code.
---

## Diagnóstico

### Ejecutar `kj doctor`

El comando de diagnóstico integrado comprueba toda tu instalación:

```bash
kj doctor
```

Ejecuta comprobaciones agrupadas por área (sistema, config, CLIs de agente, Sonar, embedder del RAG, CI, tokens, servidores MCP, puertos, Node y más); `kj doctor --verbose` muestra cada una con su solución.

Cada comprobación acaba en `OK`, `FIXED`, `WARN`, `FAIL`, `SKIPPED` o `TIMEOUT`, con una solución sugerida cuando falla.

---

## Instalación y Setup

### Binario del agente no encontrado

**Síntoma:** `kj doctor` da por ausente el CLI de un agente, o `kj code` / `kj review --staged` fallan nombrando el agente.

**Causa:** El CLI del agente no está instalado o no está en tu PATH.

**Solución:**

```bash
# Verifica que el binario es accesible
which claude    # o codex, gemini, aider

# Si no lo encuentra, instala globalmente
npm install -g @anthropic-ai/claude-code   # Claude
npm install -g @openai/codex               # Codex
kj install-tools                           # instala los CLIs de agente que kj necesita
```

Karajan busca binarios en estos directorios:
- PATH del sistema (`which`)
- `/opt/node/bin`, `~/.npm-global/bin`, `/usr/local/bin`, `~/.local/bin`
- Directorios NVM: `~/.nvm/versions/node/*/bin`

### Fichero de configuración no encontrado

**Síntoma:** `kj doctor` reporta config ausente.

**Solución:**

```bash
kj init
```

Esto crea `~/.karajan/kj.config.yml` con defaults sensatos. Para config específica del proyecto, crea `.karajan/kj.config.yml` en la raíz de tu proyecto.

---

## Problemas con SonarQube

### El contenedor no arranca

**Síntoma:** SonarQube no accesible en `http://localhost:9000`.

**Solución:**

```bash
# Comprueba si Docker está corriendo
docker ps

# Arranca el contenedor de SonarQube que gestiona kj (karajan-sonarqube)
kj sonar start
kj sonar status

# Espera ~30 segundos a que SonarQube inicialice
```

**Específico de Linux:** Si SonarQube crashea inmediatamente, aumenta el límite de memoria virtual:

```bash
sudo sysctl -w vm.max_map_count=262144
# Hacer permanente:
echo "vm.max_map_count=262144" | sudo tee -a /etc/sysctl.conf
```

### Autenticación fallida (401)

**Síntoma:** `SonarQube authentication failed` durante el scan.

**Solución:**

1. Abre `http://localhost:9000` → My Account → Security
2. Genera un nuevo token (tipo: **Global Analysis Token**)
3. Actualiza tu config:

```yaml
sonarqube:
  token: "squ_tu_nuevo_token_aqui"
```

O establece via variable de entorno: `export KJ_SONAR_TOKEN=squ_...`

### Quality gate falla repetidamente

**Síntoma:** `kj review --staged` se para una y otra vez en el pre-gate de Sonar.

**Opciones de solución:**

```bash
# Salta el pre-gate de Sonar en esta review
kj review --staged --no-sonar
```

Lo que bloquea es `sonarqube.gate_block_on` (por defecto: rating E nuevo de fiabilidad, seguridad o mantenibilidad, cobertura nueva por debajo del 80%, líneas duplicadas nuevas por encima del 5%).

### Timeout del scan

**Síntoma:** El scan de SonarQube excede el límite de tiempo.

**Solución:** Aumenta el timeout del scanner (default: 15 minutos):

```yaml
sonarqube:
  timeouts:
    scanner_ms: 1800000   # 30 minutos
```

---

## Problemas con Agentes

### El reviewer rechaza código repetidamente

**Síntoma:** `kj review --staged` rechaza el mismo cambio más de una vez.

**Solución:** que el coder aplique los hallazgos (`kj code --card <id> --retry --brief`) o, si tu agente no está de acuerdo, que arbitre una tercera IA: `kj solomon --position "<por qué>"` (los hallazgos de seguridad no se anulan nunca).

### Elegir otro reviewer

Elige otro reviewer para una review con `kj review --staged --reviewer <agente>`, o fija `reviewer_options.fallback_reviewer`; a un reviewer sin cuota lo releva otro solo en esa review, nunca el anfitrión.

---

## Problemas con el Servidor MCP

### `Transport closed` tras actualizar Karajan Code

**Síntoma:** Las llamadas MCP fallan al instante (incluso `kj_config` / `kj_doctor`) y tu host muestra `Transport closed`.

**Causa:** El host MCP sigue conectado a un proceso antiguo de `karajan-mcp`. Tras un cambio de versión, Karajan cierra procesos MCP obsoletos para que el host reinicie con código actualizado.

**Solución:**

```bash
# 1) reinicia la sesión de tu host MCP (Claude/Codex)

# 2) verifica que el servidor aparece registrado/listado
codex mcp list

# 3) smoke check antes de ejecuciones largas
# llama a kj_config y luego a kj_doctor
```

### Servidor MCP no responde

**Síntoma:** Claude Code o Codex no pueden conectar con `karajan-mcp`.

**Solución:**

```bash
# Comprueba si el proceso está corriendo
ps aux | grep karajan-mcp

# Reinicia tu agente IA (genera una nueva sesión MCP)
# O verifica la instalación
karajan-mcp --help
```

### Procesos Node huérfanos

**Síntoma:** Múltiples procesos `karajan-mcp` se acumulan.

**Solución:** Desde v1.2.3, Karajan incluye un orphan guard que termina automáticamente cuando el proceso padre muere. Para versiones anteriores:

```bash
# Encuentra y mata procesos huérfanos
ps aux | grep "karajan-code/src/mcp/server.js"
kill <pid>
```

### Códigos de error MCP

Cuando una herramienta MCP falla, el campo `category` de su respuesta dice qué ocurrió, y `suggestion` cómo arreglarlo:

| Error Type | Significado | Solución |
|-----------|------------|----------|
| `sonar_unavailable` | SonarQube no accesible | Arranca Docker, ejecuta `kj_init` |
| `auth_error` | 401 No autorizado | Regenera el token de SonarQube |
| `config_error` | Configuración inválida | Ejecuta `kj_doctor` o `kj_init` |
| `agent_missing` | CLI no encontrado | Instala el agente, ejecuta `kj_doctor` |
| `timeout` | Límite de tiempo excedido | Aumenta `timeoutMs` o `maxIterationMinutes` |
| `branch_error` | Estás en la rama base | Crea una rama de trabajo y reintenta |
| `agent_stall` | El agente dejó de producir salida | Reintenta con una tarea más pequeña |
| `bootstrap_error` | Faltan requisitos del entorno | Ejecuta `kj_doctor` y arregla lo que liste |
| `git_error` | No es un repo git | Ejecuta `git init` o navega a la raíz del proyecto |

---

## Problemas con Git

### "Not a git repository"

**Síntoma:** Karajan se niega a ejecutar.

**Solución:** Karajan requiere un repo git. Inicializa uno o navega a la raíz de tu proyecto:

```bash
git init
# o
cd /ruta/a/tu/proyecto
```

### Fallo al crear PR

**Síntoma:** `kj review --publish-pr` o `--verify-pr` fallan con un error de `gh`.

**Solución:** Asegúrate de que el GitHub CLI está instalado y autenticado:

```bash
# Instalar
brew install gh          # macOS
sudo apt install gh      # Debian/Ubuntu

# Autenticar
gh auth login

# Verificar
gh repo view
```

---

## Violaciones de Política TDD

### Cambios en source sin tests

**Síntoma:** `kj review --staged` avisa (o, con `kj gates set tests-with-code block`, rechaza) que el diff staged toca ficheros fuente sin tocar ningún test.

**Opciones de solución:**

1. **Escribe tests primero** (recomendado): modifica ficheros de test antes de la implementación
2. Los borrados y las limpiezas de solo comentarios pasan sin test; todo lo demás lo necesita.

Patrones de ficheros de test reconocidos: `/tests/`, `/__tests__/`, `.test.`, `.spec.`

---

## Coste

Karajan funciona con las suscripciones CLI de tus agentes; la página **Usage** del HU Board (`/usage.html`) suma cada llamada a un agente que lanzó kj, por proyecto y cuenta, con un CSV por proyecto y mes. Mira [Observabilidad](/docs/es/guides/observability/).

---

## Problemas con Plugins

### Plugin no se carga

**Síntoma:** El agente custom del plugin no está disponible.

**Solución:** Verifica estos requisitos:

1. El fichero está en el directorio correcto:
   - Proyecto: `<proyecto>/.karajan/plugins/*.js`
   - Global: `~/.karajan/plugins/*.js`

2. El fichero exporta una función `register`:
   ```javascript
   export function register(api) {
     api.registerAgent("my-agent", MyAgentClass, { bin: "my-cli" });
     return { name: "my-plugin" };
   }
   ```

3. El fichero es un módulo ES válido (usa `import`/`export`, no `require`/`module.exports`)

**Debug:** hoy kj no imprime los errores de carga de plugins; carga el fichero tú con `node -e 'import("./.karajan/plugins/my-plugin.js").then((m) => console.log(Object.keys(m)))'` para ver qué exporta.

### "No register() export found"

**Síntoma:** Warning en logs sobre `register()` ausente.

**Solución:** Tu plugin debe exportar una función `register` con nombre:

```javascript
// Correcto
export function register(api) { ... }

// También vale: un export default con register
export default { register(api) { ... } }

// Incorrecto — CommonJS
module.exports = { register(api) { ... } }
```

---

## FAQ

### ¿Qué agentes de IA soporta Karajan Code?

Claude, Codex, Gemini, Aider, OpenCode, Qwen, Copilot, Kimi y agy de serie (`kj agents` los lista, `kj doctor` dice cuáles están instalados). Puedes combinarlos: usa uno como coder y otro como reviewer. También puedes crear [agentes custom via plugins](/docs/es/guides/plugins/).

### ¿Puedo elegir qué modelo usa cada rol?

Sí. El modelo del coder sigue el nivel de la card (`kj hu add --tier trivial|standard|deep`) salvo que fijes uno (`roles.coder.model` en la config); el del reviewer sale de `roles.reviewer.model` o de `kj review --staged --reviewer-model <modelo>`. `kj agents` muestra qué proveedor ocupa cada rol.

### ¿Tiene coste?

Karajan Code es gratuito y open source (AGPL-3.0). Funciona con tus suscripciones CLI existentes de agentes IA (Claude Pro, Codex, etc.), sin API keys adicionales. Solo pagas tu plan actual, independientemente de cuántas tareas ejecutes. La página Usage del HU Board enseña cada llamada a un agente que lanzó kj, con sus tokens y el coste que informó su agente.

### ¿Necesito Docker?

Solo para el análisis estático con SonarQube. Omítelo con `--no-sonar` o `sonarqube.enabled: false`.

### ¿Puedo usarlo sin SonarQube?

Sí. SonarQube es opcional. Desactívalo globalmente:

```yaml
sonarqube:
  enabled: false
```

O para una review: `kj review --staged --no-sonar`

### ¿Qué pasa cuando el coder y el reviewer no se ponen de acuerdo?

Cuando tu agente no está de acuerdo con una review rechazada, `kj solomon --position "<por qué>"` pide a una tercera IA que arbitre; los hallazgos de seguridad no se anulan nunca.

### ¿Dónde veo lo que ha medido kj?

```bash
kj report                       # los bloques del proyecto: veracidad de las reviews, panel, modelos del coder (y la última sesión, si la hay)
kj report --session-id <id>     # una sesión concreta
```
