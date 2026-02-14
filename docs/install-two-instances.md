# Instalar Karajan con 2 Instancias (personal y profesional)

Esta guia te da comandos exactos para dejar dos instancias:
- `personal`
- `profesional`

## Opcion 1: Script rapido (recomendado)

```bash
cd /ruta/a/karajan-code
./scripts/setup-multi-instance.sh
```

El script te pedira:
- Sonar host
- `KJ_HOME` de personal
- `KJ_HOME` de profesional
- token Sonar personal
- token Sonar profesional
- coder/reviewer/fallback por defecto

## Opcion 2: Instalacion no interactiva (bloques exactos)

### 1) Instancia personal

```bash
cd /ruta/a/karajan-code
./scripts/install.sh \
  --non-interactive \
  --instance-name personal \
  --instance-action add \
  --link-global false \
  --kj-home /home/TU_USUARIO/.karajan-personal \
  --sonar-host http://localhost:9000 \
  --sonar-token "TU_TOKEN_PERSONAL" \
  --coder codex \
  --reviewer claude \
  --reviewer-fallback codex \
  --setup-mcp-claude false \
  --setup-mcp-codex false \
  --run-doctor true
```

### 2) Instancia profesional

```bash
cd /ruta/a/karajan-code
./scripts/install.sh \
  --non-interactive \
  --instance-name profesional \
  --instance-action add \
  --link-global false \
  --kj-home /home/TU_USUARIO/.karajan-profesional \
  --sonar-host http://localhost:9000 \
  --sonar-token "TU_TOKEN_PROFESIONAL" \
  --coder codex \
  --reviewer claude \
  --reviewer-fallback codex \
  --setup-mcp-claude false \
  --setup-mcp-codex false \
  --run-doctor true
```

## Registrar MCP en Claude y Codex (dos servidores)

Despues de instalar, configura dos MCP servers separados (uno por instancia):
- `karajan-personal`
- `karajan-profesional`

Sigue los ejemplos completos de:
- `docs/multi-instance.md`

## Verificacion rapida

```bash
# Personal
export KJ_HOME=/home/TU_USUARIO/.karajan-personal
export KJ_SONAR_TOKEN="TU_TOKEN_PERSONAL"
kj doctor

# Profesional
export KJ_HOME=/home/TU_USUARIO/.karajan-profesional
export KJ_SONAR_TOKEN="TU_TOKEN_PROFESIONAL"
kj doctor
```

Si ambos `doctor` pasan, la separacion de instancias esta correcta.
