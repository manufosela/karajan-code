# Karajan Multi-Instancia (Guia Paso a Paso)

Esta guia crea 2 instancias separadas de Karajan Code usando el mismo repo:
- `personal`
- `pro`

No necesitas duplicar el proyecto. Solo separas estado y credenciales con `KJ_HOME`.

## 0) Opcion rapida (script automatico)

Si quieres hacerlo casi todo de una vez:

```bash
cd /home/tu-usuario/ws/karajan-code
./scripts/setup-multi-instance.sh
```

Este script:
- crea/configura instancia `personal` y `pro` con `scripts/install.sh --non-interactive`
- configura MCP `karajan-personal` y `karajan-pro` en:
  - `~/.claude/settings.json`
  - `~/.codex/config.toml`

Luego solo reinicias Claude/Codex.

Nota: `scripts/install.sh` ahora detecta instancias existentes y pregunta:
- `actualizar (editar configuracion de una instancia existente)`
- `reemplazar (eliminar lo que hay y configurarlo todo de nuevo)`
- `anadir nueva (crear otra instancia mas de KJ)`

## 1) Idea rapida

Karajan guarda estado en `KJ_HOME`:
- sesiones
- entorno
- configuracion operativa

Si usas 2 `KJ_HOME`, tienes 2 instancias aisladas.

Ejemplo:
- `KJ_HOME=~/.karajan-personal`
- `KJ_HOME=~/.karajan-pro`

## 2) Preparar dos instalaciones (una por perfil)

Asumiendo que ya clonaste el repo en:
`/home/tu-usuario/ws/karajan-code`

### 2.1 Instancia personal

```bash
cd /home/tu-usuario/ws/karajan-code
./scripts/install.sh \
  --non-interactive \
  --link-global false \
  --kj-home /home/tu-usuario/.karajan-personal \
  --sonar-host http://localhost:9000 \
  --sonar-token "TU_TOKEN_PERSONAL" \
  --coder codex \
  --reviewer claude \
  --reviewer-fallback codex \
  --setup-mcp-claude false \
  --setup-mcp-codex false \
  --run-doctor true
```

### 2.2 Instancia profesional

```bash
cd /home/tu-usuario/ws/karajan-code
./scripts/install.sh \
  --non-interactive \
  --link-global false \
  --kj-home /home/tu-usuario/.karajan-pro \
  --sonar-host http://localhost:9000 \
  --sonar-token "TU_TOKEN_PRO" \
  --coder codex \
  --reviewer claude \
  --reviewer-fallback codex \
  --setup-mcp-claude false \
  --setup-mcp-codex false \
  --run-doctor true
```

## 3) Uso manual por terminal (sin MCP)

### 3.1 Perfil personal

```bash
export KJ_HOME=/home/tu-usuario/.karajan-personal
export KJ_SONAR_TOKEN="TU_TOKEN_PERSONAL"
cd /home/tu-usuario/ws/tu-proyecto-personal
kj run "Implementa login con JWT" --coder codex --reviewer claude
```

### 3.2 Perfil pro

```bash
export KJ_HOME=/home/tu-usuario/.karajan-pro
export KJ_SONAR_TOKEN="TU_TOKEN_PRO"
cd /home/tu-usuario/ws/tu-proyecto-pro
kj run "Añade auditoria de seguridad" --coder codex --reviewer claude
```

## 4) Configurar Claude con dos MCP servers

Edita `~/.claude/settings.json` y deja algo como:

```json
{
  "mcpServers": {
    "karajan-personal": {
      "command": "node",
      "args": ["/home/tu-usuario/ws/karajan-code/src/mcp/server.js"],
      "cwd": "/home/tu-usuario/ws/karajan-code",
      "env": {
        "KJ_HOME": "/home/tu-usuario/.karajan-personal",
        "KJ_SONAR_TOKEN": "TU_TOKEN_PERSONAL"
      }
    },
    "karajan-pro": {
      "command": "node",
      "args": ["/home/tu-usuario/ws/karajan-code/src/mcp/server.js"],
      "cwd": "/home/tu-usuario/ws/karajan-code",
      "env": {
        "KJ_HOME": "/home/tu-usuario/.karajan-pro",
        "KJ_SONAR_TOKEN": "TU_TOKEN_PRO"
      }
    }
  }
}
```

Reinicia Claude Code.

## 5) Configurar Codex con dos MCP servers

Edita `~/.codex/config.toml` y añade:

```toml
[mcp_servers."karajan-personal"]
command = "node"
args = ["/home/tu-usuario/ws/karajan-code/src/mcp/server.js"]
cwd = "/home/tu-usuario/ws/karajan-code"

[mcp_servers."karajan-personal".env]
KJ_HOME = "/home/tu-usuario/.karajan-personal"
KJ_SONAR_TOKEN = "TU_TOKEN_PERSONAL"

[mcp_servers."karajan-pro"]
command = "node"
args = ["/home/tu-usuario/ws/karajan-code/src/mcp/server.js"]
cwd = "/home/tu-usuario/ws/karajan-code"

[mcp_servers."karajan-pro".env]
KJ_HOME = "/home/tu-usuario/.karajan-pro"
KJ_SONAR_TOKEN = "TU_TOKEN_PRO"
```

Reinicia Codex.

## 6) Comprobar que funciona

Desde Claude/Codex, llama:
- `kj_doctor` en `karajan-personal`
- `kj_doctor` en `karajan-pro`

Si ambos responden, ya tienes multi-instancia.

## 7) Errores comunes

1. Mezcla de sesiones:
- Causa: mismo `KJ_HOME` en ambos perfiles.
- Solucion: rutas distintas (`.karajan-personal` y `.karajan-pro`).

2. Sonar 401 Unauthorized:
- Causa: token incorrecto o caducado.
- Solucion: regenerar token y actualizar `KJ_SONAR_TOKEN`.

3. MCP no aparece en el cliente:
- Causa: no reiniciaste Claude/Codex.
- Solucion: cerrar y abrir cliente.

## 8) Recomendacion de seguridad

No guardes tokens en repositorio.
Si puedes, usa variables de entorno o un gestor de secretos del sistema.
