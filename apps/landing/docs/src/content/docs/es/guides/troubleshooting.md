---
title: Solución de problemas
description: Problemas comunes y soluciones al ejecutar Karajan Code
---

## El subproceso de Claude se cuelga o no produce output

**Síntomas:** `kj_run` o `kj_code` con `coder: "claude"` se cuelga indefinidamente, muestra `0 lines` en el heartbeat, o devuelve output vacío.

**Causa raíz:** Claude Code 2.x introdujo tres cambios que rompen el spawn de `claude -p` como subproceso desde Node.js:

### 1. Guard de anidamiento `CLAUDECODE`

Claude Code 2.x establece `CLAUDECODE=1` en su entorno para prevenir sesiones anidadas. Cuando el servidor MCP de Karajan (que corre dentro de Claude Code) lanza `claude -p`, el proceso hijo ve `CLAUDECODE=1` y se niega a arrancar.

**Fix:** Eliminar la variable antes del spawn:

```js
const { CLAUDECODE, ...env } = process.env;
// pasar env a las opciones de execa/spawn
```

### 2. La herencia de stdin bloquea al hijo

Cuando Node.js lanza un proceso hijo, hereda el stdin del padre por defecto. Si el padre (Claude Code / servidor MCP) ya está consumiendo stdin, el hijo `claude -p` se bloquea esperando input que nunca llega.

**Fix:** Desconectar stdin:

```js
{ stdin: "ignore" }  // en las opciones de execa/spawn
```

### 3. La salida estructurada va a stderr, no stdout

Sin TTY, Claude Code 2.x escribe toda la salida estructurada (`--output-format json` o `stream-json`) a **stderr**. stdout queda vacío. Si solo lees stdout, no obtienes nada.

**Fix:** Leer de ambos y preferir el que tenga contenido:

```js
function pickOutput(result) {
  return result.stdout || result.stderr || "";
}
```

### Solución completa

Karajan implementa los tres fixes en `src/agents/claude-agent.js`:

```js
function cleanExecaOpts(extra = {}) {
  const { CLAUDECODE, ...env } = process.env;
  return { env, stdin: "ignore", ...extra };
}

function pickOutput(res) {
  return res.stdout || res.stderr || "";
}
```

Cada llamada a `runCommand()` en el agente Claude usa `cleanExecaOpts()`, y cada resultado se lee a través de `pickOutput()`.

### Cómo verificar

```bash
# Esto se cuelga (hereda env + stdin):
claude -p "Reply PONG" --output-format json

# Esto funciona (env limpio, sin stdin, leer stderr):
env -u CLAUDECODE claude -p "Reply PONG" --output-format json < /dev/null 2>&1
```

:::note
Este problema solo afecta a Claude Code 2.x cuando se lanza como subproceso. Otros agentes (Codex, Gemini, Aider) no se ven afectados. Corregido en Karajan v1.9.6.
:::

## El checkpoint detiene la sesión inesperadamente

**Síntomas:** `kj_run` se detiene después de unos minutos aunque el coder esté progresando.

**Causa raíz:** El sistema de checkpoints interactivos se dispara cada 5 minutos (configurable). Cuando se ejecuta vía MCP, pregunta al agente AI qué hacer mediante `elicitInput`. Si la respuesta es null (timeout, error, o el AI no entendió la pregunta), versiones anteriores lo trataban como "stop".

**Fix (v1.10.0):** Las respuestas null/vacías ahora se tratan como "continuar 5 minutos más". Solo un "4" explícito o "stop" detiene la sesión.

También puedes ajustar el intervalo del checkpoint:

```yaml
# kj.config.yml
session:
  checkpoint_interval_minutes: 10  # por defecto: 5
```

## El coder se cuelga con wizards interactivos de CLI

**Síntomas:** `kj_run` o `kj_code` se cuelga cuando la tarea requiere ejecutar un CLI interactivo como `pnpm create astro`, `npm init`, o `create-react-app`.

**Causa raíz:** El agente coder se ejecuta como subproceso no interactivo con `stdin: "ignore"`. Cualquier comando que pida input al usuario se colgará para siempre.

**Fix (v1.10.0):** El prompt del coder ahora incluye restricciones de subproceso que instruyen al agente a:
- Usar flags no interactivos: `--yes`, `--no-input`, `--template <nombre>`, `--defaults`
- Nunca ejecutar comandos que esperen input del usuario
- Reportar claramente si una tarea no puede completarse de forma no interactiva

Si el coder aún se cuelga, considera ejecutar la parte interactiva manualmente y luego usar Karajan para el trabajo de código.

## Sesión detenida — no se puede reanudar

**Síntomas:** `kj_resume` dice que la sesión tiene status "stopped" y no la reanuda.

**Fix (v1.10.0):** `kj_resume` ahora acepta sesiones stopped y failed (no solo paused). Re-ejecuta el flow desde cero con la tarea y configuración originales.

## Sin progreso visible durante ejecución MCP

**Síntomas:** Lanzas `kj_run` vía MCP (desde Claude Code, Codex, etc.) y el host no muestra nada durante minutos. No sabes si Karajan está corriendo, colgado o terminó.

**Causa raíz:** Las tool calls MCP no hacen streaming de output parcial. El host solo muestra el resultado final cuando la llamada completa. Fases largas (SonarQube scans, ejecución del coder) no producen feedback visible.

**Fix:** Usa `kj-tail` en otra terminal para monitorizar el log en tiempo real.

### Instalar kj-tail

**Compatibilidad**: Linux, macOS y WSL. Requiere `bash` y `tail -F` (estándar en los tres).

```bash
# Copiar desde el paquete Karajan a un directorio en tu PATH
cp node_modules/karajan-code/bin/kj-tail ~/.local/bin/kj-tail
chmod +x ~/.local/bin/kj-tail

# Asegúrate de que ~/.local/bin esté en tu PATH (añadir a .bashrc/.zshrc si es necesario)
export PATH="$HOME/.local/bin:$PATH"
```

### Uso

```bash
# Desde cualquier directorio — pasa la ruta del proyecto donde kj_run está ejecutando
kj-tail ~/mi-proyecto

# Si ya estás en el directorio del proyecto
kj-tail
```

`kj-tail` hace tail de `<proyecto>/.kj/run.log` con colores por stage:

| Color | Stage |
|-------|-------|
| **Verde** | Coder |
| **Amarillo** | Reviewer |
| **Azul** | SonarQube |
| **Magenta** | Solomon |
| **Rojo** | Errores / fallos |
| **Cyan (bold)** | Sesión, iteración, kj_run |
| **Gris** | Heartbeats |

Elimina los timestamps y la etiqueta redundante `[agent:output]` para un stream limpio y legible.

:::tip
Abre una segunda terminal y ejecuta `kj-tail` siempre que lances `kj_run` vía MCP. Es la mejor forma de seguir lo que Karajan hace en tiempo real.
:::
