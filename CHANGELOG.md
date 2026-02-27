# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `package.json` metadata for npm publish (repository, keywords, engines, author, license, files)
- `SECURITY.md` with vulnerability reporting policy
- `CHANGELOG.md`
- Pre-commit hook blocking LLM attribution in commits (`.githooks/pre-commit`)

## [0.2.0] - 2026-02-27

### Added
- Per-model pricing table for accurate budget tracking in USD (#49)
- `kj report` command with session export and `--format json` (#50)
- Model selection flags `--coder-model`, `--reviewer-model`, `--planner-model` per role (#45)
- Planning-game client with timeout, network error, and JSON parse handling (#46)
- `buildTaskPrompt` and `updateCardOnCompletion` in planning-game adapter (#46)
- Configurable SonarQube settings: container name, volumes, network, timeouts (#47)
- Support for external SonarQube with `sonarqube.external=true` (#47)
- `RefactorerRole` export and template verification (#48)

### Fixed
- `coderModel` flag no longer leaks into other roles' model selection (#45)

## [0.1.0] - 2026-02-24

### Added
- **Core orchestrator**: coder -> sonar -> reviewer loop with configurable iterations
- **CLI commands**: `init`, `config`, `run`, `code`, `review`, `scan`, `doctor`, `plan`, `resume`, `sonar`
- **4 AI agents**: Claude, Codex, Gemini, Aider with auto-detection
- **10 pipeline roles**: Planner, Coder, Refactorer, Reviewer, Tester, Security, Researcher, Sonar, Solomon, Commiter
- **BaseRole abstraction** with standardized lifecycle (init -> execute -> report)
- **Role .md templates** with custom instruction support per project
- **SonarQube integration**: Docker management, quality gates, enforcement profiles
- **TDD-by-default** methodology with test change enforcement
- **Review profiles**: standard, strict, paranoid, relaxed, custom
- **Budget tracking**: token and cost tracking per session
- **Planning Game MCP integration**: task context and completion updates
- **MCP server** with 10 tools and real-time progress notifications
- **Session management**: pause/resume, fail-fast detection, activity logging
- **Git automation**: auto-commit, auto-push, auto-PR, auto-rebase
- **Streaming output**: real-time agent output in CLI and MCP
- **Solomon arbitration**: conflict resolution between AI agents
- **Interactive installer**: one-command setup with multi-instance support
- **CI/CD**: GitHub Actions workflow with validation and PR annotations
- **716+ unit tests** with Vitest

[Unreleased]: https://github.com/manufosela/karajan-code/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/manufosela/karajan-code/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/manufosela/karajan-code/releases/tag/v0.1.0
