---
title: Sistema de Plugins
description: Extiende Karajan Code con agentes custom via plugins.
---

El sistema de plugins de Karajan Code permite registrar agentes de IA personalizados sin modificar el código fuente. Crea un fichero `.js`, implementa la interfaz `BaseAgent`, y tu agente estará disponible en todo el pipeline.

## Descubrimiento de plugins

Los plugins se auto-descubren desde dos ubicaciones:

1. **Nivel de proyecto**: `<proyecto>/.karajan/plugins/*.js`
2. **Nivel de usuario**: `~/.karajan/plugins/*.js` (o `$KJ_HOME/plugins/`)

Todos los ficheros `.js` en estos directorios se cargan. Los plugins de proyecto se cargan primero, luego los de usuario. Los plugins que fallen al cargar se registran como warnings sin afectar al resto.

## Crear un plugin

Un plugin es un módulo JavaScript que exporta una función `register`:

```javascript
// ~/.karajan/plugins/my-agent.js

import { BaseAgent } from "karajan-code/src/agents/base-agent.js";
import { runCommand } from "karajan-code/src/utils/process.js";
import { resolveBin } from "karajan-code/src/agents/resolve-bin.js";

class MyAgent extends BaseAgent {
  async runTask(task) {
    const timeout = this.config.session.max_iteration_minutes * 60 * 1000;
    const model = this.getRoleModel(task.role || "coder");

    const args = ["generate", "--input", task.prompt];
    if (model) args.push("--model", model);

    const res = await runCommand(resolveBin("my-cli"), args, {
      timeout,
      onOutput: task.onOutput
    });

    return {
      ok: res.exitCode === 0,
      output: res.stdout,
      error: res.stderr,
      exitCode: res.exitCode
    };
  }

  async reviewTask(task) {
    const timeout = this.config.session.max_iteration_minutes * 60 * 1000;
    const model = this.getRoleModel(task.role || "reviewer");

    const args = ["review", "--format", "json", "--input", task.prompt];
    if (model) args.push("--model", model);

    const res = await runCommand(resolveBin("my-cli"), args, {
      timeout,
      onOutput: task.onOutput
    });

    return {
      ok: res.exitCode === 0,
      output: res.stdout,
      error: res.stderr,
      exitCode: res.exitCode
    };
  }
}

export function register(api) {
  api.registerAgent("my-agent", MyAgent, {
    bin: "my-cli",
    installUrl: "https://github.com/example/my-cli#install"
  });

  return { name: "my-agent-plugin" };
}
```

## La interfaz BaseAgent

Cada agente custom debe extender `BaseAgent` e implementar dos métodos:

### runTask(task)

Se llama cuando el agente actúa como **coder**, **planner**, **refactorer**, o cualquier rol que escribe código.

**Input:**
```javascript
{
  prompt: "string",        // Prompt completo con instrucciones
  role: "coder",           // Nombre del rol actual
  onOutput: function       // Opcional: callback para streaming de output
}
```

**Return esperado:**
```javascript
{
  ok: true,                // true si el agente tuvo éxito
  output: "string",        // stdout del agente
  error: "string",         // stderr del agente
  exitCode: 0              // Código de salida del proceso
}
```

### reviewTask(task)

Se llama cuando el agente actúa como **reviewer**. Mismo formato de input/output que `runTask`.

### Métodos helper

`BaseAgent` proporciona estos helpers:

- `this.getRoleModel(role)` — Devuelve el modelo configurado para el rol dado (de `config.roles[role].model`)
- `this.isAutoApproveEnabled(role)` — Si auto-approve está activado
- `this.config` — Configuración completa de Karajan
- `this.logger` — Instancia del logger
- `this.name` — Nombre del agente

## La API de register

El objeto `api` pasado a tu función `register` proporciona:

### api.registerAgent(name, AgentClass, metadata)

Registrar un agente custom en el registry global.

**Parámetros:**
- `name` (string) — Identificador único del agente usado en config y CLI
- `AgentClass` (class) — Clase que extiende `BaseAgent`
- `metadata` (object) — Metadatos del agente:
  - `bin` (string) — Nombre del binario CLI (usado para verificar disponibilidad)
  - `installUrl` (string) — URL de instalación (mostrada cuando falta el agente)

**Valor de retorno:**

Tu función `register` debe devolver un objeto con al menos `name`:

```javascript
return { name: "my-plugin", version: "1.0.0" };
```

## Usar tu plugin

Una vez el plugin está en su sitio, usa el nombre del agente en config o CLI:

**Config:**
```yaml
coder: my-agent
reviewer: my-agent

roles:
  coder:
    model: my-agent/fast-model
  reviewer:
    model: my-agent/smart-model
```

**CLI:**
```bash
kj run "Añadir autenticación" --coder my-agent --reviewer my-agent
```

**MCP:**
```json
{
  "tool": "kj_run",
  "params": {
    "task": "Añadir autenticación",
    "coder": "my-agent",
    "reviewer": "my-agent"
  }
}
```

## Ejemplo mínimo de plugin

El plugin más simple posible:

```javascript
// ~/.karajan/plugins/echo-agent.js

import { BaseAgent } from "karajan-code/src/agents/base-agent.js";

class EchoAgent extends BaseAgent {
  async runTask(task) {
    return { ok: true, output: `Echo: ${task.prompt}`, error: "", exitCode: 0 };
  }

  async reviewTask(task) {
    const review = JSON.stringify({
      approved: true,
      blocking_issues: [],
      suggestions: [],
      confidence: 1.0
    });
    return { ok: true, output: review, error: "", exitCode: 0 };
  }
}

export function register(api) {
  api.registerAgent("echo", EchoAgent, { bin: null });
  return { name: "echo-plugin" };
}
```

## Manejo de errores

Los plugins deben manejar errores de forma grácil:

```javascript
async runTask(task) {
  try {
    const res = await runCommand(resolveBin("my-cli"), args, { timeout });
    return { ok: res.exitCode === 0, output: res.stdout, error: res.stderr, exitCode: res.exitCode };
  } catch (err) {
    this.logger.error(`Error del agente: ${err.message}`);
    return { ok: false, output: "", error: err.message, exitCode: 1 };
  }
}
```

Si un plugin falla al cargar (error de sintaxis, dependencia faltante), Karajan registra un warning y continúa. Otros plugins y agentes built-in no se ven afectados.

## Agentes built-in como referencia

Los agentes built-in siguen el mismo patrón que los plugins:

- `src/agents/claude-agent.js` — Anthropic Claude
- `src/agents/codex-agent.js` — OpenAI Codex
- `src/agents/gemini-agent.js` — Google Gemini
- `src/agents/aider-agent.js` — Aider
- `src/agents/opencode-agent.js` — OpenCode CLI wrapper

Estudia estos ficheros para ver ejemplos reales de implementaciones de `runTask` y `reviewTask`.
