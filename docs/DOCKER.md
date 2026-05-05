# Karajan Code - Docker

Run Karajan Code without installing Node.js or npm on your host machine.

## Build the image

```bash
docker build -t karajan-code .
```

Or with docker compose:

```bash
docker compose build
```

## Run commands

### kj (default entrypoint)

```bash
# Show help
docker run --rm -v "$PWD":/workspace karajan-code --help

# Run doctor
docker run --rm -v "$PWD":/workspace karajan-code doctor

# Run the pipeline
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
# Run kj commands
docker compose run --rm kj doctor
docker compose run --rm kj run

# Run kj-tail
docker compose run --rm --entrypoint kj-tail kj

# Run karajan-mcp
docker compose run --rm -i --entrypoint karajan-mcp kj
```

## Limitations

- **No agent CLIs inside the container**: The image only includes `kj`, `kj-tail`, and `karajan-mcp`. Agent CLIs (claude, codex, aider, gemini) must be available on the host or configured to run externally.
- **No SonarQube Docker-in-Docker**: Running SonarQube analysis from inside the container would require Docker-in-Docker, which is not supported. Run SonarQube on the host instead.
- **No interactive wizards**: The container runs non-interactively. Commands that require TTY input may not work as expected.

---

> 🇪🇸 [Leer en español](es/DOCKER.md)
