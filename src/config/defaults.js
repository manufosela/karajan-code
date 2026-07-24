/**
 * Karajan's default configuration — the baseline every user's config is
 * merged on top of.
 *
 * This is **pure data**. It was extracted from `src/config.js` in TSK-0332
 * (Oleada 2 of the v2.7.4 audit refactor) so that consumers that only
 * need the shape (schema tests, display, docs) don't drag the loader's
 * fs/yaml imports.
 *
 * Source of truth is here; `src/config.js` re-exports `DEFAULTS` for
 * back-compat.
 */

const DEFAULTS = {
  coder: "claude",
  reviewer: "codex",
  roles: {
    planner: { provider: null, model: null },
    coder: { provider: null, model: null },
    reviewer: { provider: null, model: null },
    refactorer: { provider: null, model: null },
    solomon: { provider: null, model: null },
    researcher: { provider: null, model: null },
    tester: { provider: null, model: null },
    security: { provider: null, model: null },
    impeccable: { provider: null, model: null },
    triage: { provider: null, model: null },
    discover: { provider: null, model: null },
    architect: { provider: null, model: null },
    hu_reviewer: { provider: null, model: null },
    start: { provider: null, model: "haiku" }
  },
  pipeline: {
    planner: { enabled: false },
    refactorer: { enabled: false },
    solomon: { enabled: true },
    researcher: { enabled: false },
    tester: { enabled: true },
    security: { enabled: true },
    impeccable: { enabled: false },
    perf: { enabled: false },
    triage: { enabled: true },
    discover: { enabled: false },
    architect: { enabled: false },
    hu_reviewer: { enabled: false },
    brain: { enabled: true },
    auto_simplify: true
  },
  brain: {
    enabled: true,
    provider: "claude",
    bypass_solomon_on_correctness: true,
    max_consecutive_verification_failures: 2
  },
  review_mode: "standard",
  max_iterations: 5,
  hu_max_iterations: 3,
  // Hard per-run spend ceiling, ON by default (KJC-TSK-0621): a stuck or
  // runaway run must never drain a subscription quota unattended. Explicit
  // null in the user's config opts out (no cap).
  max_budget_usd: 5,
  // ENV-D1 (KJC-TSK-0642): where work items live. The HU Board ships with
  // kj; "planning-game" routes the v4 playbook to the user's PG MCP;
  // "external" (KJC-TSK-0684) points card-first at the project's own board
  // (Linear, Trello, Jira, GitHub Issues…) named in board.name — worked
  // through the host agent's MCP/tools, never mirrored by kj. There is NO
  // "none": Karajan does not run without a board.
  state_backend: "hu-board",
  board: { name: null },
  // Method gates (KJC-PCS-0068): rules climb from playbook text to
  // deterministic enforcement. card_first: "auto" = block with hu-board
  // (fully verifiable), warn with planning-game/external (presence only);
  // explicit "warn" | "block" override. Release branches are exempt.
  method_gates: {
    card_first: "auto",
    card_first_exempt_branches: ["chore/release-"],
    // MG-B: source changes without a test change — "warn" | "block".
    tests_with_code: "warn"
  },
  review_rules: "./.karajan/review-rules.md",
  coder_rules: "./.karajan/coder-rules.md",
  base_branch: "main",
  coder_options: { model: null, auto_approve: true, fallback_coder: null },
  reviewer_options: {
    output_format: "json",
    require_schema: true,
    model: null,
    deterministic: true,
    retries: 1,
    fallback_reviewer: null
  },
  development: {
    methodology: "tdd",
    require_test_changes: true,
    // KJC-TSK-0398: opt-in red-then-green gate. When true, the pipeline
    // stashes source files and re-runs the test suite to confirm the new
    // tests actually fail without the implementation. Off by default to
    // preserve current iteration latency.
    require_red_then_green: false,
    test_file_patterns: ["/tests/", "/__tests__/", ".test.", ".spec."],
    source_file_extensions: [".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".java", ".rb", ".php", ".cs"]
  },
  sonarqube: {
    enabled: true,
    host: "http://localhost:9000",
    external: false,
    container_name: "karajan-sonarqube",
    network: "karajan_sonar_net",
    volumes: {
      data: "karajan_sonar_data",
      logs: "karajan_sonar_logs",
      extensions: "karajan_sonar_extensions"
    },
    timeouts: {
      healthcheck_seconds: 5,
      compose_up_ms: 300000,
      compose_control_ms: 120000,
      logs_ms: 30000,
      scanner_ms: 900000
    },
    token: null,
    project_key: null,
    admin_user: null,
    admin_password: null,
    coverage: {
      enabled: false,
      command: null,
      timeout_ms: 300000,
      block_on_failure: true,
      lcov_report_path: null
    },
    quality_gate: true,
    enforcement_profile: "pragmatic",
    gate_block_on: [
      "new_reliability_rating=E",
      "new_security_rating=E",
      "new_maintainability_rating=E",
      "new_coverage<80",
      "new_duplicated_lines_density>5"
    ],
    fail_on: ["BLOCKER", "CRITICAL"],
    ignore_on: ["INFO"],
    max_scan_retries: 3,
    scanner: {
      sources: "src,public,lib",
      exclusions: "**/node_modules/**,**/fake-apps/**,**/scripts/**,**/playground/**,**/dist/**,**/build/**,**/*.min.js",
      test_inclusions: "**/*.test.js,**/*.spec.js,**/tests/**,**/__tests__/**",
      coverage_exclusions: "**/tests/**,**/__tests__/**,**/*.test.js,**/*.spec.js",
      disabled_rules: ["javascript:S1116", "javascript:S3776"]
    }
  },
  sonarcloud: {
    enabled: false,
    organization: null,
    token: null,
    project_key: null,
    host: "https://sonarcloud.io",
    scanner: {
      sources: "src,public,lib",
      exclusions: "**/node_modules/**,**/dist/**,**/build/**,**/*.min.js",
      test_inclusions: "**/*.test.js,**/*.spec.js,**/tests/**,**/__tests__/**"
    }
  },
  hu_board: {
    enabled: false,
    port: 4000,
    auto_start: false
  },
  language: "en",
  hu_language: "en",
  policies: {},
  serena: { enabled: false },
  planning_game: { enabled: false, project_id: null, codeveloper: null },
  skills: {
    mode: "auto",
    sources: ["addyosmani", "openskills", "local"],
    addyosmani: {
      enabled: true,
      refreshDays: 7,
      repoUrl: "https://github.com/addyosmani/agent-skills.git"
    }
  },
  ci: { enabled: false, review_event: "kj-review", comment_event: "kj-comment", comment_prefix: true },
  git: { auto_commit: false, auto_push: false, auto_pr: false, auto_rebase: true, branch_prefix: "feat/" },
  output: { report_dir: "./.reviews", log_level: "info", quiet: true },
  budget: {
    warn_threshold_pct: 80,
    currency: "usd",
    exchange_rate_eur: 0.92
  },
  model_selection: {
    enabled: true,
    tiers: {},
    role_overrides: {}
  },
  session: {
    // Opt-in per-iteration supervision (KJC-TSK-0628): pause after each
    // iteration with a report and ask continue / stop / instructions.
    iteration_gate: false,
    // Concurrent HU lanes per plan run (KJC-TSK-0626). 1 = sequential.
    // Raising it multiplies token burn rate — the plan budget scales with it.
    max_parallel_hus: 1,
    // Command run inside each fresh lane worktree before the coder starts
    // (KJC-TSK-0630). null = auto-detect: `npm ci` when package-lock.json
    // exists, nothing otherwise. Submodules are always initialized first.
    worktree_setup: null,
    max_iteration_minutes: 30,
    max_total_minutes: 120,
    max_planner_minutes: 60,
    checkpoint_interval_minutes: 5,
    max_agent_silence_minutes: 20,
    fail_fast_repeats: 2,
    repeat_detection_threshold: 2,
    max_sonar_retries: 3,
    max_reviewer_retries: 3,
    max_tester_retries: 1,
    max_security_retries: 1,
    max_auto_resumes: 2,
    expiry_days: 30
  },
  failFast: {
    repeatThreshold: 2
  },
  webperf: {
    enabled: true,
    devtools_mcp: false,
    thresholds: { lcp: 2500, cls: 0.1, inp: 200 }
  },
  rag: {
    // KJC-TSK-0455 — Auto-refresh the local RAG index. `onRun` runs a
    // delta re-index before every `kj run`; `onCommit` is consulted by
    // `kj rag install-hooks` to decide whether to install the post-merge
    // hook. Both default ON; flip to false to opt out without uninstalling.
    autoUpdate: { onCommit: true, onRun: true },
    // KJC-TSK-0682 — sensitivity of the indexed code. Cloud embedders
    // (openai/voyage/cohere/mistral) require an explicit "public"; the
    // safe default blocks them (local ollama/onnx always allowed).
    sensitivity: "internal"
  },
  // Opt-in. Set by the `kj init` wizard (explicit consent prompt in the OS
  // locale). When the key is absent or false, no events are sent. See
  // src/utils/telemetry.js and the Privacy & Telemetry section of README.md.
  telemetry: false,
  guards: {
    output: {
      enabled: true,
      patterns: [],
      protected_files: [],
      on_violation: "block"
    },
    perf: {
      enabled: true,
      patterns: [],
      block_on_warning: false,
      frontend_extensions: []
    },
    intent: {
      enabled: false,
      patterns: [],
      confidence_threshold: 0.85
    }
  }
};
export { DEFAULTS };

