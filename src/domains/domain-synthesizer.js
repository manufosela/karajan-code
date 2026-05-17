/**
 * Domain context synthesizer.
 * Filters relevant sections from domain files based on task + hints,
 * and compacts the output to stay within a token budget.
 */

const DEFAULT_MAX_TOKENS = 4000;
const CHARS_PER_TOKEN = 4;

/**
 * Synthesize a domain context string from selected domains,
 * filtered by relevance to the task and domain hints.
 *
 * @param {Object} params
 * @param {string} params.task — task description
 * @param {string[]} params.domainHints — keywords from triage
 * @param {import('./domain-loader.js').DomainFile[]|null} params.selectedDomains
 * @param {number} [params.maxTokens=4000] — token budget (0 = unlimited)
 * @returns {string} synthesized markdown context or empty string
 */
export function synthesizeDomainContext({ task, domainHints = [], selectedDomains, maxTokens = DEFAULT_MAX_TOKENS }) {
  if (!selectedDomains?.length) return "";

  const keywords = buildKeywords(task, domainHints);
  const domainBlocks = [];

  for (const domain of selectedDomains) {
    const sections = domain.sections || [];
    if (!sections.length) continue;

    // Score all sections but include them all (domain was explicitly selected).
    // Sort by relevance so highest-scoring sections survive token truncation.
    const scored = sections
      .map(section => ({
        section,
        score: scoreSection(section, keywords)
      }))
      .sort((a, b) => b.score - a.score);

    const selected = scored.map(s => s.section);

    const sectionMd = selected
      .map(s => `#### ${s.heading}\n${s.content}`)
      .join("\n\n");

    domainBlocks.push(`### ${domain.name}\n\n${sectionMd}`);
  }

  if (!domainBlocks.length) return "";

  let result = domainBlocks.join("\n\n---\n\n");

  // Truncate by token budget if needed
  if (maxTokens > 0) {
    const maxChars = maxTokens * CHARS_PER_TOKEN;
    if (result.length > maxChars) {
      result = truncateBySection(result, maxChars);
    }
  }

  return result;
}

/**
 * Build a set of lowercase keywords from task text and domain hints.
 * @param {string} task
 * @param {string[]} hints
 * @returns {string[]}
 */
function buildKeywords(task, hints) {
  const words = new Set();

  // Add domain hints
  for (const h of hints) {
    words.add(h.toLowerCase());
  }

  // Extract meaningful words from task (>3 chars, skip stop words)
  const stopWords = new Set(["the", "this", "that", "with", "from", "have", "will", "should", "could", "would", "been", "being", "their", "there", "where", "when", "what", "which", "about", "into", "some", "than", "then", "them", "they", "also", "each", "more", "most", "other"]);

  const taskWords = task
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  for (const w of taskWords) {
    words.add(w);
  }

  return Array.from(words);
}

/**
 * Score a section by keyword overlap.
 * @param {import('./domain-loader.js').DomainSection} section
 * @param {string[]} keywords
 * @returns {number}
 */
function scoreSection(section, keywords) {
  const text = `${section.heading} ${section.content}`.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) score++;
  }
  return score;
}

/**
 * Truncate result by dropping trailing sections to fit within maxChars.
 * Preserves complete sections rather than cutting mid-sentence.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function truncateBySection(text, maxChars) {
  // Split by section markers (#### or ###)
  const parts = text.split(/(?=^#{3,4}\s)/m);
  let result = "";

  for (const part of parts) {
    if (result.length + part.length > maxChars && result.length > 0) {
      break;
    }
    result += part;
  }

  return result.trim();
}
