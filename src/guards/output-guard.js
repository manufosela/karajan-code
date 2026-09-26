// Built-in destructive patterns
const DESTRUCTIVE_PATTERNS = [
  { id: "rm-rf", pattern: /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+)*-[a-zA-Z]*r/, severity: "critical", message: "Recursive file deletion detected" },
  { id: "drop-table", pattern: /DROP\s+(TABLE|DATABASE|SCHEMA)/i, severity: "critical", message: "SQL destructive operation detected" },
  { id: "git-reset-hard", pattern: /git\s+reset\s+--hard/i, severity: "critical", message: "Hard git reset detected" },
  { id: "git-push-force", pattern: /git\s+push\s+.*--force/i, severity: "critical", message: "Force push detected" },
  { id: "truncate-table", pattern: /TRUNCATE\s+TABLE/i, severity: "critical", message: "SQL truncate detected" },
  { id: "format-disk", pattern: /mkfs\.|fdisk|dd\s+if=/, severity: "critical", message: "Disk format operation detected" },
];

// Built-in credential patterns (ALL critical — secrets must NEVER be committed)
const CREDENTIAL_PATTERNS = [
  { id: "aws-key", pattern: /AKIA[0-9A-Z]{16}/, severity: "critical", message: "AWS access key exposed" },
  { id: "private-key", pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/, severity: "critical", message: "Private key exposed" },
  { id: "generic-secret", pattern: /(password|secret|token|api_key|apikey)\s*[:=]\s*["'][^"']{8,}["']/i, severity: "critical", message: "Hardcoded secret detected. Move it to the environment or a secrets manager" },
  { id: "github-token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/, severity: "critical", message: "GitHub token exposed" },
  { id: "npm-token", pattern: /npm_[A-Za-z0-9]{36,}/, severity: "critical", message: "npm token exposed" },
  { id: "openai-key", pattern: /sk-[A-Za-z0-9]{20,}/, severity: "critical", message: "OpenAI API key exposed" },
  { id: "anthropic-key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/, severity: "critical", message: "Anthropic API key exposed" },
  { id: "stripe-key", pattern: /sk_live_[A-Za-z0-9]{20,}/, severity: "critical", message: "Stripe secret key exposed" },
  { id: "stripe-test", pattern: /sk_test_[A-Za-z0-9]{20,}/, severity: "critical", message: "Stripe test key exposed. Use .env even for test keys" },
  { id: "google-api-key", pattern: /AIza[A-Za-z0-9_-]{35}/, severity: "critical", message: "Google API key exposed" },
  { id: "firebase-key", pattern: /"apiKey"\s*:\s*"AIza[A-Za-z0-9_-]{35}"/, severity: "critical", message: "Firebase API key hardcoded. Use .env file" },
  { id: "slack-token", pattern: /xox[bpors]-[A-Za-z0-9-]{10,}/, severity: "critical", message: "Slack token exposed" },
  { id: "jwt-secret", pattern: /jwt[_-]?secret\s*[:=]\s*["'][^"']{8,}["']/i, severity: "critical", message: "JWT secret hardcoded. Use .env file" },
  { id: "database-url", pattern: /(mongodb|postgres|mysql|redis):\/\/[^"'\s]+:[^"'\s]+@/i, severity: "critical", message: "Database URL with credentials exposed. Use .env file" },
  { id: "hardcoded-key-assignment", pattern: /(?:const|let|var)\s+\w*(?:key|secret|token|password)\w*\s*=\s*["'][A-Za-z0-9_-]{16,}["']/i, severity: "critical", message: "Hardcoded key in an assignment. Move it to the environment or a secrets manager" },
];

// Default protected files (block if these appear in added/modified lines)
const DEFAULT_PROTECTED_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  "serviceAccountKey.json",
  "credentials.json",
];

export function compilePatterns(configGuards) {
  const customPatterns = Array.isArray(configGuards?.output?.patterns)
    ? configGuards.output.patterns.map(p => ({
        id: p.id || "custom",
        pattern: typeof p.pattern === "string" ? new RegExp(p.pattern, p.flags || "") : p.pattern,
        severity: p.severity || "warning",
        message: p.message || "Custom pattern matched",
      }))
    : [];

  return [...DESTRUCTIVE_PATTERNS, ...CREDENTIAL_PATTERNS, ...customPatterns];
}

export function compileProtectedFiles(configGuards) {
  const custom = Array.isArray(configGuards?.output?.protected_files)
    ? configGuards.output.protected_files
    : [];
  return [...new Set([...DEFAULT_PROTECTED_FILES, ...custom])];
}

/**
 * Parse a unified diff to extract only added lines (lines starting with +, not ++)
 */
export function extractAddedLines(diff) {
  if (!diff) return [];
  const results = [];
  let currentFile = null;
  let lineNum = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      continue;
    }
    if (line.startsWith("@@ ")) {
      const match = /@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
      lineNum = match ? Number.parseInt(match[1], 10) - 1 : 0;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      lineNum += 1;
      results.push({ file: currentFile, line: lineNum, content: line.slice(1) });
    } else if (!line.startsWith("-")) {
      lineNum += 1;
    }
  }
  return results;
}

/**
 * Check if any modified files are in the protected list
 */
export function checkProtectedFiles(diff, protectedFiles) {
  const violations = [];
  const modifiedFiles = [];

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      modifiedFiles.push(line.slice(6));
    }
  }

  for (const file of modifiedFiles) {
    const basename = file.split("/").pop();
    if (protectedFiles.some(pf => file === pf || file.endsWith(`/${pf}`) || basename === pf)) {
      violations.push({
        id: "protected-file",
        severity: "critical",
        file,
        line: 0,
        message: `Protected file modified: ${file}`,
        matchedContent: "",
      });
    }
  }

  return violations;
}

/**
 * KJC-BUG-0215 (issue #1733): estas dos reglas acusan por el NOMBRE del
 * identificador, no por la forma del valor, asi que un prefijo de cache llamado
 * EXPERIMENTS_HANDOFF_TOKENS_NAMESPACE bloqueo una ejecucion entera con
 * severidad critica y sin salida. Las demas reglas miran el valor (AKIA…,
 * sk_live_…) y esas aciertan.
 *
 * El arreglo NO es adivinar: la review tumbo tres heuristicas seguidas y con
 * razon, porque `const dbPassword = "db-password"` tambien tiene pinta inocente
 * y es una credencial. Lo que faltaba era CAUCE: que el proyecto pueda declarar
 * la excepcion en su configuracion versionada, donde se revisa en la PR como
 * cualquier otra linea, y que el guard diga como hacerlo cuando bloquea.
 */
const NAME_BASED_RULES = new Set(["hardcoded-key-assignment", "generic-secret"]);

const HOW_TO_DECLARE = "If it is not a secret, declare it in guards.output.non_secret_assignments as NAME or path/to/file:NAME";

/** El identificador al que se asigna, cuando la linea deja leerlo. */
const assignedName = (content) => /([A-Za-z_$][\w$]*)\s*[:=]\s*["']/.exec(content)?.[1] ?? null;

/** Una entrada declarada se lee como `NAME` o `path/to/file:NAME`. */
const splitEntry = (entry) => {
  const cut = entry.lastIndexOf(":");
  return cut === -1 ? { path: null, name: entry } : { path: entry.slice(0, cut), name: entry.slice(cut + 1) };
};

/**
 * Excepcion DECLARADA, no inferida: el proyecto afirma por escrito que esta
 * asignacion no guarda un secreto. Sin `file` la declaracion vale para todo el
 * repositorio; con el, solo para ese fichero, que es lo estrecho y preferible.
 */
export function declaredNonSecret(configGuards, file, content) {
  const declared = configGuards?.output?.non_secret_assignments;
  if (!Array.isArray(declared) || declared.length === 0) return false;
  const name = assignedName(content);
  if (!name) return false;
  return declared.some(entry => {
    if (typeof entry !== "string") return false;
    const target = splitEntry(entry.trim());
    return target.name === name && (target.path === null || target.path === file);
  });
}

/**
 * Scan a diff for pattern violations.
 * Returns { pass: boolean, violations: Array<{id, severity, file, line, message, matchedContent}> }
 */
export function scanDiff(diff, config = {}) {
  if (!diff || typeof diff !== "string") {
    return { pass: true, violations: [] };
  }

  const configGuards = config?.guards || {};
  const patterns = compilePatterns(configGuards);
  const protectedFiles = compileProtectedFiles(configGuards);
  const addedLines = extractAddedLines(diff);
  const violations = [];

  // Check patterns against added lines
  for (const { file, line, content } of addedLines) {
    for (const { id, pattern, severity, message } of patterns) {
      if (!pattern.test(content)) continue;
      const matchedContent = content.trim().slice(0, 200);
      // KJC-BUG-0215: una regla que acusa por el nombre necesita un cauce
      // declarado para el falso positivo, y decirlo cuando bloquea.
      if (!NAME_BASED_RULES.has(id)) {
        violations.push({ id, severity, file, line, message, matchedContent });
      } else if (declaredNonSecret(configGuards, file, content)) {
        violations.push({ id, severity: "warning", file, line, matchedContent,
          message: `${message}. Declared as non-secret in guards.output.non_secret_assignments` });
      } else {
        violations.push({ id, severity, file, line, matchedContent, message: `${message}. ${HOW_TO_DECLARE}` });
      }
    }
  }

  // Check protected files
  violations.push(...checkProtectedFiles(diff, protectedFiles));

  const hasCritical = violations.some(v => v.severity === "critical");
  return { pass: !hasCritical, violations };
}

export { DESTRUCTIVE_PATTERNS, CREDENTIAL_PATTERNS, DEFAULT_PROTECTED_FILES };
