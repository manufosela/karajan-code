# Karajan Code - Docker

> 🇬🇧 [Read in English](../DOCKER.md)

Ejecuta Karajan Code sin instalar Node.js ni npm en tu maquina.

## Construir la imagen

```bash
docker build -t karajan-code .
```

O con docker compose:

```bash
docker compose build
```

## Ejecutar comandos

### kj (entrypoint por defecto)

```bash
# Mostrar ayuda
docker run --rm -v "$PWD":/workspace karajan-code --help

# Ejecutar doctor
docker run --rm -v "$PWD":/workspace karajan-code doctor

# Ejecutar el pipeline
docker run --rm -v "$PWD":/workspace karajan-code run
```

### kj-tail

```bash
docker run --rm --entrypoint kj-tail -v "$PWD":/workspace karajan-code
```

### karajan-mcp

```bash
docker run --rm -i --entrypoint karajan-mcp -v "$PWD":/workspace karajan-code
```

## Docker Compose

```bash
# Ejecutar comandos kj
docker compose run --rm kj doctor
docker compose run --rm kj run

# Ejecutar kj-tail
docker compose run --rm --entrypoint kj-tail kj

# Ejecutar karajan-mcp
docker compose run --rm -i --entrypoint karajan-mcp kj
```

## Limitaciones

- **Sin CLIs de agentes dentro del contenedor**: La imagen solo incluye `kj`, `kj-tail` y `karajan-mcp`. Los CLIs de agentes (claude, codex, aider, gemini) deben estar disponibles en el host o configurados externamente.
- **Sin SonarQube Docker-in-Docker**: Ejecutar analisis de SonarQube desde dentro del contenedor requeriria Docker-in-Docker, que no esta soportado. Ejecuta SonarQube en el host.
- **Sin wizards interactivos**: El contenedor se ejecuta de forma no interactiva. Los comandos que requieran entrada TTY pueden no funcionar correctamente.
