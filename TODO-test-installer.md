# TODO: Probar instalador de Karajan Code (2026-02-17)

## Contexto

Se consolidaron las dos instancias de SonarQube (puertos 9000 y 9001) en una sola
con PostgreSQL 17. La instalacion de SonarQube Docker y Chrome DevTools MCP se movio
desde el instalador de Planning Game MCP al de Karajan Code (commit `bc3d61e`).

## Que probar

### 1. Verificar SonarQube Docker

Si en el otro portatil NO hay SonarQube corriendo, el instalador deberia montarlo.
Si ya hay uno, deberia detectarlo y saltar ese paso.

```bash
# Verificar estado
docker ps | grep sonar
```

### 2. Ejecutar el instalador

```bash
cd ~/ws_npm-packages/karajan-code
./scripts/install.sh
```

Verificar:
- [ ] Detecta/instala SonarQube+PostgreSQL via Docker
- [ ] NO muestra "Generate automatically" para el token
- [ ] Muestra instrucciones claras de donde crear el token en SonarQube web
- [ ] Pregunta por Chrome DevTools MCP
- [ ] Doctor y tests pasan
- [ ] Resumen final correcto

### 3. Cambiar password de admin

Si el SonarQube es nuevo (admin/admin), cambiar password:
1. Abrir http://localhost:9000
2. Login con admin/admin
3. Crear token: My Account > Security > Generate Token (karajan-cli, Global Analysis)

### 4. Re-escanear proyectos

```bash
cd ~/mcp-servers/planning-game
SONAR_TOKEN=<token> npx @sonar/scan
```

## Ficheros modificados

| Repo | Commit | Cambio |
|------|--------|--------|
| planning-game-mcp | `e9af40f` | Eliminada instalacion de SonarQube/Chrome del install.sh |
| karajan-code | `bc3d61e` | Añadida instalacion de SonarQube Docker + Chrome DevTools MCP |

## Borrar este fichero cuando se haya probado
