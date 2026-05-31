// KJC-PCS-0052 PR-B.2.2 — Rust adapter. Detección por Cargo.toml; target/
// y skip segments evitan que el indexer recorra builds. chunk-rust usa
// AST (tree-sitter) cuando el caller hizo `await prepareRust()` y cae a
// regex en otro caso (mismo patrón que PYTHON_ADAPTER).
import { chunkRust } from "./chunk-rust.js";

export const RUST_ADAPTER = {
  id: "rust",
  extensions: [".rs"],
  skipSegments: ["target", ".cargo"],
  manifests: ["Cargo.toml", "Cargo.lock"],
  chunkSource: chunkRust,
};
