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

Realiza **8 comprobaciones**:

| Check | Qué verifica |
|-------|-------------|
| Config file | `~/.karajan/kj.config.yml` o `.karajan/kj.config.yml` existe |
| Git repository | Estás dentro de un repo git |
| Docker | `docker --version` responde |
| SonarQube | `http://localhost:9000` es accesible y healthy |
| Agent CLIs | Cada binario de agente (claude, codex, gemini, aider) responde a `--version` |
| Core binaries | node, npm, git están instalados |
| Serena MCP | Opcional — verifica `serena --version` cuando está habilitado |
| Rule files | Existen ficheros `.md` en directorios `.karajan/` |

Cada comprobación muestra `OK` o `MISS` con una solución sugerida.

---

## Instalación y Setup

### Binario del agente no encontrado

**Síntoma:** `kj doctor` muestra `MISS` para un agente, o `kj run` falla con "agent not found".

**Causa:** El CLI del agente no está instalado o no está en tu PATH.

**Solución:**

```bash
# Verifica que el binario es accesible
which claude    # o codex, gemini, aider

# Si no lo encuentra, instala globalmente
npm install -g @anthropic-ai/claude-code   # Claude
npm install -g @openai/codex               # Codex
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

### Valores de configuración inválidos

**Síntoma:** Error sobre `review_mode` o `methodology` inválido.

**Solución:** Asegura valores válidos:

```yaml
# review_mode debe ser uno de:
mode: standard   # paranoid | strict | standard | relaxed | custom

# methodology debe ser uno de:
development:
  methodology: tdd   # tdd | standard
```

---

## Problemas con SonarQube

### El contenedor no arranca

**Síntoma:** SonarQube no accesible en `http://localhost:9000`.

**Solución:**

```bash
# Comprueba si Docker está corriendo
docker ps

# Arranca SonarQube
docker start sonarqube-db sonarqube

# Si los contenedores no existen, créalos
docker compose -f ~/sonarqube/docker-compose.yml up -d

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

**Síntoma:** El pipeline se bloquea en el quality gate de SonarQube incluso para issues menores.

**Opciones de solución:**

```bash
# Saltar SonarQube para esta ejecución
kj run "Mi tarea" --no-sonar

# O usar enforcement lenient en config
```

```yaml
sonarqube:
  enforcement_profile: lenient   # En lugar del default "strict"
```

El quality gate por defecto bloquea en: reliability rating E, security rating E, maintainability rating E, coverage por debajo de 80%, líneas duplicadas por encima del 5%.

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

### El agente da timeout durante la ejecución

**Síntoma:** El agente no completa dentro del límite de tiempo por iteración.

**Solución:** Aumenta el timeout por iteración (default: 15 minutos):

```bash
kj run "Tarea compleja" --max-iteration-minutes 30
```

O en config:

```yaml
session:
  max_iteration_minutes: 30
```

### El reviewer rechaza código repetidamente

**Síntoma:** El bucle coder/reviewer se ejecuta múltiples iteraciones sin aprobación.

**Causa:** El reviewer encuentra los mismos problemas en cada iteración (la detección de repeticiones se activa tras 2 conjuntos consecutivos de issues idénticos).

**Opciones de solución:**

1. **Reducir max iterations** para fallar rápido:
   ```bash
   kj run "Tarea" --max-iterations 3
   ```

2. **Usar modo de revisión relaxed** para código menos crítico:
   ```bash
   kj run "Tarea" --mode relaxed
   ```

3. **Reanudar con guía** si la sesión se pausa:
   ```bash
   kj resume --session <id> --answer "Enfócate en el issue de seguridad, ignora sugerencias de estilo"
   ```

### Fallo al parsear output del reviewer

**Síntoma:** `Reviewer output must be a JSON object` o `missing boolean field: approved`.

**Causa:** El agente reviewer devolvió JSON malformado en lugar del formato de review esperado.

**Solución:** Normalmente es un problema transitorio. El pipeline reintenta automáticamente. Si persiste:
- Prueba un reviewer diferente: `--reviewer claude` en lugar de `--reviewer codex`
- Usa la config de reviewer fallback:

```yaml
reviewer: codex
reviewer_fallback: claude
```

---

## Problemas con el Servidor MCP

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

Cuando `kj_run` u otras herramientas MCP devuelven errores, el campo `errorType` indica qué ocurrió:

| Error Type | Significado | Solución |
|-----------|------------|----------|
| `sonar_unavailable` | SonarQube no accesible | Arranca Docker, ejecuta `kj_init` |
| `auth_error` | 401 No autorizado | Regenera el token de SonarQube |
| `config_error` | Configuración inválida | Ejecuta `kj_doctor` o `kj_init` |
| `agent_missing` | CLI no encontrado | Instala el agente, ejecuta `kj_doctor` |
| `timeout` | Límite de tiempo excedido | Aumenta `timeoutMs` o `maxIterationMinutes` |
| `rate_limit` | Agente alcanzó su límite de uso | Espera al reset de la ventana de tokens, luego `kj resume` |
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

**Síntoma:** `gh pr create` falla durante auto-commit.

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

### La rama base divergió durante la ejecución

**Síntoma:** Warning sobre la rama base detrás del remoto.

**Solución:**

```bash
# Rebase manual
git rebase origin/main

# O usar auto-rebase
kj run "Tarea" --auto-rebase
```

---

## Violaciones de Política TDD

### Cambios en source sin tests

**Síntoma:** `source_changes_without_tests` — la política TDD detectó cambios en ficheros fuente sin cambios correspondientes en tests.

**Opciones de solución:**

1. **Escribe tests primero** (recomendado): modifica ficheros de test antes de la implementación
2. **Desactiva TDD para esta ejecución:**
   ```bash
   kj run "Fix rápido" --methodology standard
   ```
3. **Desactiva en config:**
   ```yaml
   development:
     methodology: standard
     require_test_changes: false
   ```

Patrones de ficheros de test reconocidos: `/tests/`, `/__tests__/`, `.test.`, `.spec.`

---

## Presupuesto y Control de Costes

### ¿Cómo funciona el tracking de presupuesto?

**Importante:** El tracking de costes de Karajan es **estimado, no facturación real**. Dado que Karajan ejecuta agentes CLI (Claude Code, Codex CLI, etc.) que usan tus suscripciones existentes, los costes reportados son una aproximación de lo que *gastarías* si usaras las APIs directamente. Se calculan a partir del conteo de tokens (input/output) multiplicados por las tarifas publicadas de cada modelo.

Esto es útil para:
- Comparar coste relativo entre distintas combinaciones de agente/modelo
- Entender qué etapas del pipeline consumen más tokens
- Establecer guardarraíles para evitar sesiones descontroladas

Ver desglose con:

```bash
kj report --trace
```

### ¿Cuál es la ventaja de usar agentes CLI vs APIs?

Una ventaja clave del enfoque CLI de Karajan es el **coste predecible**. Tus agentes IA se ejecutan bajo tus planes de suscripción existentes (Claude Pro, Codex, etc.), así que nunca pagas más que la tarifa de tu plan independientemente de cuántas tareas ejecutes.

Si un agente CLI alcanza su límite de ventana de uso (ej: el tope de tokens de Claude), el proceso del agente se detiene — Karajan detecta automáticamente el mensaje de rate-limit en la salida del agente y pausa la sesión en lugar de marcarla como fallida. Puedes reanudar cuando la ventana de tokens se restablezca:

```bash
kj resume --session <session-id>
```

Karajan reconoce patrones de rate-limit de todos los agentes soportados (Claude, Codex, Gemini, Aider), incluyendo errores HTTP 429 y mensajes específicos de límite de uso de cada proveedor.

También puedes configurar un **agente de fallback automático** para que el pipeline continúe sin interrupción:

```yaml
coder_options:
  fallback_coder: codex   # Cambiar a Codex si Claude llega a su límite
```

O por ejecución: `kj run "Tarea" --coder-fallback codex`

Cuando el agente primario llega a su límite y hay un fallback configurado, Karajan cambia automáticamente al agente alternativo para esa iteración. Si todos los agentes están limitados, la sesión se pausa.

### ¿Cómo establezco un límite de presupuesto?

Los límites de presupuesto actúan como guardarraíles sobre costes estimados:

```yaml
budget:
  max_budget_usd: 50
  warn_threshold_pct: 80   # Avisa al 80% gastado
```

O por ejecución:

```bash
kj run "Tarea" --max-budget-usd 10
```

Cuando el presupuesto estimado alcanza el 100%, la sesión termina con razón `budget_exceeded`.

### ¿Cómo veo costes en EUR?

```yaml
budget:
  currency: eur
  exchange_rate_eur: 0.92
```

O: `kj report --currency eur`

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

**Debug:** Activa logging de depuración para ver detalles de carga de plugins: `--log-level debug`

### "No register() export found"

**Síntoma:** Warning en logs sobre `register()` ausente.

**Solución:** Tu plugin debe exportar una función `register` con nombre:

```javascript
// Correcto
export function register(api) { ... }

// Incorrecto — export default
export default { register(api) { ... } }

// Incorrecto — CommonJS
module.exports = { register(api) { ... } }
```

---

## FAQ

### ¿Qué agentes de IA soporta Karajan Code?

Claude, Codex, Gemini y Aider de serie. Puedes combinarlos — usa uno como coder y otro como reviewer. También puedes crear [agentes custom via plugins](/docs/es/guides/plugins/).

### ¿Tiene coste?

Karajan Code es gratuito y open source (AGPL-3.0). Funciona con tus suscripciones CLI existentes de agentes IA (Claude Pro, Codex, etc.) — no necesita API keys adicionales. Solo pagas tu plan actual, independientemente de cuántas tareas ejecutes. Usa `kj report --trace` para ver el desglose estimado de costes por ejecución.

### ¿Necesito Docker?

Solo para el análisis estático con SonarQube. Omítelo con `--no-sonar` o `sonarqube.enabled: false`.

### ¿Puedo usarlo sin SonarQube?

Sí. SonarQube es opcional. Desactívalo globalmente:

```yaml
sonarqube:
  enabled: false
```

O por ejecución: `kj run "Tarea" --no-sonar`

### ¿Qué modos de revisión hay disponibles?

| Modo | Descripción |
|------|-------------|
| `paranoid` | Más estricto — todas las reglas activas, requiere 100% aprobación |
| `strict` | Muy estricto — la mayoría de reglas, estándares altos |
| `standard` | Equilibrado — reglas pragmáticas (default) |
| `relaxed` | Permisivo — menos reglas, aprobación más rápida |
| `custom` | Reglas definidas por el usuario en `.karajan/` |

### ¿Puedo reanudar una sesión pausada?

Sí. Cuando una sesión se pausa (detección de repeticiones, aviso de presupuesto, escalado humano):

```bash
kj resume --session <session-id> --answer "Tu guía aquí"
```

### ¿Qué pasa cuando el coder y el reviewer no se ponen de acuerdo?

Tras rechazos idénticos repetidos (default: 2 iteraciones), Karajan puede:
1. **Escalado Solomon** — un árbitro IA media (si `pipeline.solomon.enabled: true`)
2. **Escalado humano** — pausa la sesión para tu input
3. **Max iteraciones alcanzado** — para y reporta el conflicto

### ¿Cómo funciona la lógica de retry?

Karajan reintenta automáticamente en errores transitorios: timeouts de conexión, conexiones rechazadas, HTTP 429/500/502/503/504. Usa backoff exponencial (1s → 2s → 4s, máximo 30s). Configura en:

```yaml
retry:
  max_retries: 3
  backoff_multiplier: 2
  max_backoff_ms: 30000
```

### ¿Dónde se guardan los logs de sesión?

Las sesiones se almacenan localmente. Consúltalas con:

```bash
kj report                  # Resumen de la última sesión
kj report --trace          # Desglose detallado de costes
kj report --session <id>   # Sesión específica
```
