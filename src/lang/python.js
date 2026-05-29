// KJC-PCS-0052 PR-A — Python adapter. Primer lenguaje no-JS soportado
// por el RAG indexer. La detección por manifest (pyproject.toml,
// setup.py, requirements.txt, Pipfile) activa el adapter; los virtualenvs
// y caches típicos se excluyen del walk para no contaminar el índice con
// dependencias ya vendoreadas. El chunker AST (tree-sitter) llega en PR-B;
// hasta entonces, la cadena chunkSourceAST → chunkSourceRegex → windowText
// devuelve windowing puro para .py (sigue siendo recuperable, solo sin
// metadata.symbol).
export const PYTHON_ADAPTER = {
  id: "python",
  extensions: [".py"],
  skipSegments: ["__pycache__", ".venv", "venv", ".tox", ".pytest_cache", ".mypy_cache", ".ruff_cache"],
  manifests: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"],
};
