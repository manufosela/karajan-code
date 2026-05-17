/**
 * REASONS Canvas markdown parser.
 *
 * Reads a `SPEC.canvas.md` file and returns a Canvas object that
 * validates against canvas/schema.js.
 *
 * Format:
 *
 *   # <title>
 *
 *   ## REASONS:Requirements
 *   <problem statement, free text>
 *
 *   Definition of done:
 *   - bullet 1
 *   - bullet 2
 *
 *   ## REASONS:Entities
 *   - `User` — fields: id, email. has-many Order.
 *   - `Order` — ...
 *
 *   ## REASONS:Approach
 *   <free text>
 *
 *   ## REASONS:Structure
 *   - touches: src/auth/*, src/orders/*
 *   - depends_on: TokenService
 *   - contracts: POST /orders, GET /orders/:id
 *
 *   ## REASONS:Operations
 *   1. <title>
 *      Acceptance:
 *      - shell: `cmd here`
 *      - gherkin: ```Given … When … Then …```
 *   2. ...
 *
 *   ## REASONS:Norms
 *   - bullet
 *
 *   ## REASONS:Safeguards
 *   - bullet
 *
 * Permissive on whitespace and bullet style ("- ", "* ", "1. ").
 * Strict on structure: a missing required section ⇒ exception with a
 * pointer to which section is missing.
 */

const SECTION_HEADER_RE = /^##\s+REASONS:(\w+)\s*$/i;
const TITLE_RE = /^#\s+(.+?)\s*$/;
const BULLET_RE = /^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/;
const ACCEPTANCE_HEADER_RE = /^\s*Acceptance(?:\s+tests?)?\s*:\s*$/i;
const TEST_LINE_RE = /^\s*(?:[-*])\s+(shell|gherkin)\s*:\s*(.+?)\s*$/i;

/**
 * Parse a SPEC.canvas.md string into a Canvas object.
 * Throws { name: "CanvasParseError", message } on missing required sections.
 *
 * @param {string} source — markdown text
 * @returns {object} Canvas object (un-validated against schema; caller validates)
 */
export function parseCanvasMarkdown(source) {
  if (typeof source !== "string" || source.length === 0) {
    throw makeError("Canvas markdown is empty or not a string.");
  }

  const lines = source.split(/\r?\n/);
  const sections = {};
  let title = null;
  let currentName = null;
  let currentBuf = [];

  // First pass: split into sections.
  for (const line of lines) {
    const titleMatch = line.match(TITLE_RE);
    if (titleMatch && currentName === null && title === null) {
      title = titleMatch[1].trim();
      continue;
    }
    const sectionMatch = line.match(SECTION_HEADER_RE);
    if (sectionMatch) {
      // flush previous
      if (currentName) {
        sections[currentName] = currentBuf.join("\n");
      }
      currentName = sectionMatch[1].toLowerCase();
      currentBuf = [];
      continue;
    }
    if (currentName) currentBuf.push(line);
  }
  if (currentName) sections[currentName] = currentBuf.join("\n");

  if (!title) throw makeError("Missing title — first line must be `# <title>`.");

  // Required sections — must be PRESENT (header exists), but content
  // may be empty for sections like Structure where every key is
  // optional. Use `in` so an empty-body section is accepted.
  for (const required of ["requirements", "approach", "structure", "operations"]) {
    if (!(required in sections)) {
      throw makeError(`Missing required section: ## REASONS:${capitalize(required)}`);
    }
  }

  return {
    title,
    requirements: parseRequirements(sections.requirements),
    entities: sections.entities ? parseEntities(sections.entities) : [],
    approach: sections.approach.trim(),
    structure: parseStructure(sections.structure),
    operations: parseOperations(sections.operations),
    norms: sections.norms ? parseBullets(sections.norms) : [],
    safeguards: sections.safeguards ? parseBullets(sections.safeguards) : [],
  };
}

function capitalize(s) {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

function makeError(msg) {
  const e = new Error(msg);
  e.name = "CanvasParseError";
  return e;
}

/**
 * Requirements: a paragraph (problem) + optional "Definition of done:" bullets.
 */
function parseRequirements(text) {
  const lines = text.split("\n");
  const problemLines = [];
  const done = [];
  let inDone = false;
  for (const line of lines) {
    if (/^\s*Definition of done:?\s*$/i.test(line)) { inDone = true; continue; }
    if (inDone) {
      const m = line.match(BULLET_RE);
      if (m) done.push(m[1].trim());
      continue;
    }
    if (line.trim()) problemLines.push(line.trim());
  }
  const problem = problemLines.join(" ").trim();
  if (!problem) throw makeError("REASONS:Requirements is empty or has no problem statement.");
  return { problem, done };
}

/**
 * Entities: each bullet is "Name — fields: f1, f2. notes." (loose).
 * We parse the first word as the entity name and capture the rest as notes.
 */
function parseEntities(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const m = raw.match(BULLET_RE);
    if (!m) continue;
    const body = m[1].trim();
    // First token (possibly `quoted`) is the name; rest is notes.
    const nameMatch = body.match(/^[`"']?([A-Za-z][\w-]*)[`"']?\s*[—-]?\s*(.*)$/);
    if (!nameMatch) continue;
    const [, name, rest] = nameMatch;
    const fields = [];
    const fm = rest.match(/fields?:\s*([^.]+)/i);
    if (fm) fields.push(...fm[1].split(",").map((s) => s.trim()).filter(Boolean));
    out.push({ name, fields, notes: rest });
  }
  return out;
}

function parseStructure(text) {
  const out = { touches: [], depends_on: [], contracts: [] };
  for (const raw of text.split("\n")) {
    const m = raw.match(BULLET_RE);
    if (!m) continue;
    const body = m[1].trim();
    const kvMatch = body.match(/^(touches|depends_on|contracts)\s*:\s*(.+)$/i);
    if (!kvMatch) continue;
    const key = kvMatch[1].toLowerCase();
    const values = kvMatch[2].split(",").map((s) => s.trim()).filter(Boolean);
    out[key] = values;
  }
  return out;
}

function parseBullets(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const m = raw.match(BULLET_RE);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/**
 * Operations: each top-level numbered/bulleted entry is one Operation.
 * Inside, an "Acceptance:" sub-line introduces nested bullets where each
 * bullet is "shell: <cmd>" or "gherkin: <scenario>".
 */
function parseOperations(text) {
  const ops = [];
  const lines = text.split("\n");
  let current = null;
  let inAcceptance = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    // Top-level operation: numbered list or single dash at left margin.
    const topMatch = line.match(/^(\d+\.\s+|[-*]\s+)(.+)$/);
    if (topMatch && !line.startsWith("    ") && !line.startsWith("\t")) {
      if (current) ops.push(current);
      current = { title: topMatch[2].trim(), acceptance: [] };
      inAcceptance = false;
      continue;
    }
    if (current) {
      if (ACCEPTANCE_HEADER_RE.test(line)) { inAcceptance = true; continue; }
      const testMatch = line.match(TEST_LINE_RE);
      if (testMatch && inAcceptance) {
        current.acceptance.push({
          type: testMatch[1].toLowerCase(),
          content: testMatch[2].replaceAll(/^`+|`+$/g, "").trim(),
        });
      }
    }
  }
  if (current) ops.push(current);

  if (ops.length === 0) {
    throw makeError("REASONS:Operations has no operations. Each operation must be a numbered or bulleted item with at least one acceptance test.");
  }
  for (const op of ops) {
    if (op.acceptance.length === 0) {
      throw makeError(`Operation "${op.title}" has no acceptance tests. Add at least one ` +
        '`- shell: <cmd>` or `- gherkin: <scenario>` under an "Acceptance:" line.');
    }
  }
  return ops;
}
