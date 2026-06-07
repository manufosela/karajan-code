// Shim: vec-store primitives now live in @karajan/core/vec-store so
// the hu-board workspace can consume them without a relative dep on the
// CLI src tree. KJC-TSK-0511 PR4.
export {
  dbPath,
  openVecStore,
  insertChunk,
  searchSimilar,
  projectSlug,
  deleteChunksBySource,
  getLastIndexedCommit,
  setLastIndexedCommit,
  getEmbeddingsByIds,
  findChunkByHash,
  countChunks,
  searchBM25,
} from "@karajan/core/vec-store";
