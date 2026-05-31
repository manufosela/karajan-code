// KJC-PCS-0052 PR-A/PR-B — Python adapter. Detección por manifest activa
// el adapter; virtualenvs y caches se excluyen del walk. PR-B añade
// `chunkSource` regex top-level (def/async def/class) — tree-sitter real
// queda para PR-B.2 (decisión WASM vs native).
import { chunkPython, preparePython } from "./chunk-python.js";

export const PYTHON_ADAPTER = {
  id: "python",
  extensions: [".py"],
  skipSegments: ["__pycache__", ".venv", "venv", ".tox", ".pytest_cache", ".mypy_cache", ".ruff_cache"],
  manifests: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"],
  chunkSource: chunkPython,
  prepare: preparePython,
};
