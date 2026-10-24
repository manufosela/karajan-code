/**
 * KJC-TSK-1171 (RAG-B, ADR 0026): the shared tail of every code chunker. A chunker
 * finds marks ({ idx, symbol, parent? }); this slices the text from each mark to the
 * next, windows what is too long for the embedder, and stamps each piece with its
 * 1-based line range and the symbol it belongs to, so the embedded header and the
 * citations can name file, symbol, parent and lines.
 */
const DEFAULT_LIMIT = 800;
const DEFAULT_OVERLAP = 100;

/** 1-based line of a character index. */
export const lineAt = (text, idx) => {
  let line = 1;
  for (let i = 0; i < idx && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
};

// Trailing whitespace (a newline and the next line's indentation) is not a line of the symbol.
const linesIn = (piece) => {
  const body = piece.trimEnd();
  let n = 0;
  for (let i = 0; i < body.length; i += 1) if (body.charCodeAt(i) === 10) n += 1;
  return n;
};

/** The slice at `startIdx`, windowed, each piece with its line range. */
export function pieceSpans(text, startIdx, slice, { limit = DEFAULT_LIMIT, overlap = DEFAULT_OVERLAP } = {}) {
  const step = Math.max(1, limit - overlap);
  const out = [];
  for (let i = 0; ; i += step) {
    const piece = slice.slice(i, i + limit);
    const startLine = lineAt(text, startIdx + i);
    out.push({ text: piece, start_line: startLine, end_line: startLine + linesIn(piece) });
    if (i + limit >= slice.length) break;
  }
  return out;
}

/** Chunks from marks; with no marks, the whole text as one anonymous symbol. */
export function spanChunks(text, marks, { path = "<src>", kind = "code", language, limit, overlap } = {}) {
  const base = { source: path, kind, ...(language === undefined ? {} : { language }) };
  const ranges = marks.length === 0
    ? [{ start: 0, end: text.length, symbol: null, parent: null }]
    : marks.map((m, i) => ({ start: m.idx, end: i + 1 < marks.length ? marks[i + 1].idx : text.length, symbol: m.symbol, parent: m.parent ?? null }));
  return ranges.flatMap(({ start, end, symbol, parent }) =>
    pieceSpans(text, start, text.slice(start, end), { limit, overlap }).map(({ text: piece, start_line, end_line }) => ({
      text: piece, metadata: { ...base, symbol, parent, start_line, end_line },
    })));
}
