// Shim: where-parser now lives in karajan-core/rag so the hu-board
// workspace can consume it without a relative dep on the CLI src tree.
// KJC-TSK-0632 PR2.
export { parseWhere, buildWhereSql } from "karajan-core/rag/where-parser";
