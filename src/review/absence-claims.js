/**
 * KJC-BUG-0545 (#3822): a finding that says "the diff does not change X" is checked against
 * the whole diff. If X appears on an ADDED line of any file the claim is false: the finding
 * leaves the findings and is recorded in `dropped`, so nothing is hidden. Deterministic, no
 * model call. Security findings are never dropped (same rule as KJC-TSK-1195).
 */
const ABSENCE = [
  /\b(?:does|do|did)(?: not|n't) (?:change|add|include|touch|modify|update|contain|introduce|gate|apply)\b/i,
  /\b(?:is|are|was|were)(?: not|n't) (?:in|part of|added|included|changed) /i,
  /\b(?:is|are) (?:missing|absent)\b/i,
  /\bmissing from the diff\b/i,
  /\bnever (?:added|changed|included)\b/i,
];

const IDENT = String.raw`[A-Za-z_$][\w$]*`;
const tail = (s) => s.replace(/\(.*$/s, "").split(".").pop();

/** Code symbols a text names: backticked `x`, or a member/call such as Foo.bar() or bar(). */
export function symbolsOf(text) {
  const found = new Set();
  for (const m of text.matchAll(/`([^`]+)`/g)) found.add(tail(m[1].trim()));
  for (const m of text.matchAll(new RegExp(String.raw`\b${IDENT}(?:\.${IDENT})+(?:\(\))?|\b${IDENT}\(\)`, "g"))) found.add(tail(m[0]));
  return [...found].filter((s) => new RegExp(`^${IDENT}$`).test(s) && s.length >= 3);
}

const TEST_FILE = /(?:(?:^|\/)(?:tests?|__tests__)\/)|(?:\.(?:test|spec)\.[cm]?[jt]sx?$)/;
// A claim about tests, coverage or docs of X is not a claim that X itself is absent.
const ABOUT_SOMETHING_ELSE = /\b(tests?|coverage|docs?|documentation|comments?)\b/i;

/**
 * What a source (non-test) file of the diff changes: its added lines, and the function
 * context git prints in the @@ header of each hunk that adds a line (a change inside a
 * method's body names the method there, not on the added line).
 */
function changedText(diff) {
  const texts = [];
  let file = null;
  let hunk = null;
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/.* b\/(.*)$/.exec(line);
    if (header) { file = header[1]; hunk = null; continue; }
    if (!file || TEST_FILE.test(file)) continue;
    if (line.startsWith("@@")) { hunk = line.replace(/^@@[^@]*@@/, ""); continue; }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      texts.push({ file, text: line.slice(1) });
      if (hunk) { texts.push({ file, text: hunk }); hunk = null; }
    }
  }
  return texts;
}

// Symbols are identifiers (IDENT), so `$` is the only character to escape.
const ESCAPED_DOLLAR = String.raw`\$`;
const symbolRe = (symbol) => {
  const escaped = symbol.replaceAll("$", ESCAPED_DOLLAR);
  return String.raw`(?<![\w$])${escaped}(?![\w$])`;
};
const changedIn = (texts, symbol) => {
  const re = new RegExp(symbolRe(symbol));
  return texts.find((l) => re.test(l.text))?.file ?? null;
};

const NEAR = 40;
// The text between an absence phrase and a symbol occurrence within NEAR chars on either side, else null.
function gapBetween(text, phrase, sym) {
  const phraseEnd = phrase.index + phrase[0].length;
  const symEnd = sym.index + sym[0].length;
  if (sym.index >= phraseEnd && sym.index - phraseEnd <= NEAR) return text.slice(phraseEnd, sym.index);
  if (symEnd <= phrase.index && phrase.index - symEnd <= NEAR) return text.slice(symEnd, phrase.index);
  return null;
}

/** The absence is claimed of the symbol itself: some phrase next to some occurrence of it, nothing about tests or docs in between. */
function claimsAbsenceOf(text, symbol) {
  const occurrences = [...text.matchAll(new RegExp(symbolRe(symbol), "g"))];
  return ABSENCE.some((re) => [...text.matchAll(new RegExp(re.source, `${re.flags}g`))].some((phrase) =>
    occurrences.some((sym) => {
      const gap = gapBetween(text, phrase, sym);
      return gap !== null && !ABOUT_SOMETHING_ELSE.test(gap);
    })));
}

/**
 * Splits findings into { kept, dropped, keptIndices }; dropped entries are { finding, reason }.
 * keptIndices are the positions of the kept findings in the input, so per-finding data
 * (a verifier's outcomes) can be filtered the same way.
 */
export function dropFalseAbsences(findings, diff) {
  const changed = changedText(diff ?? "");
  const kept = [];
  const dropped = [];
  const keptIndices = [];
  findings.forEach((f, i) => {
    const hit = falseAbsence(f, changed);
    if (hit) dropped.push({ finding: f, reason: `the diff changes ${hit.symbol} in ${hit.file}` });
    else { kept.push(f); keptIndices.push(i); }
  });
  return { kept, dropped, keptIndices };
}

function falseAbsence(f, changed) {
  if (String(f.category ?? "").toLowerCase() === "security") return null;
  const text = String(f.description ?? "");
  for (const symbol of symbolsOf(text)) {
    if (!claimsAbsenceOf(text, symbol)) continue;
    const file = changedIn(changed, symbol);
    if (file) return { symbol, file };
  }
  return null;
}
