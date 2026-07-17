# Parallel HU execution (worktree lanes)

Since v3.14.0 a plan's independent HUs can run concurrently, each in its own
git worktree. Epic KJC-PCS-0065 + KJC-TSK-0629.

## Usage

```bash
kj run --plan <planId> --parallel 2        # up to 2 concurrent HU lanes
# or persistent:
# .karajan/kj.config.yml → session.max_parallel_hus: 2
```

Default is `1` (fully sequential — exactly the pre-3.14 behavior). Parallelism
is strictly opt-in.

## How a lane works

1. The scheduler (`hu-scheduler.js`) walks the `blocked_by` graph and picks
   runnable HUs; HUs with overlapping `scope` path prefixes never share a
   chunk, and a scopeless HU runs alone (`partitionConflictFree`).
2. Each HU in a multi-lane chunk gets a worktree at
   `.kj/worktrees/<huId>` on branch `kj-hu-<huId>` (created by
   `git worktree add -b`, primitive in `karajan-core/worktree`).
3. The whole lane runs INSIDE that worktree: the coder prompt's project-root
   rule, the pre-coder snapshot, acceptance tests, TDD/review diffs, sonar
   (serialized via `withLock("sonar-scan")`) and the final commit/push all use
   the lane dir (`laneConfig.projectDir`), never the main working tree.
4. Lane state is isolated: `laneConfig`, `laneFlags`, `laneSession` (cloned),
   `laneBrain` and `lanePlannedTask` are per-lane copies — per-HU policies
   (spike/doc/infra) cannot leak into a sibling lane.
5. Approved lanes merge back sequentially (`mergeWorktree`: merge
   `kj-hu-<id>` into the main tree's branch, remove worktree, delete branch).
   Failed lanes get their worktree removed without merging.

## Lane bootstrap

A fresh worktree is a clean checkout — no `node_modules`, no initialized
submodules. Before the coder starts, each lane runs (KJC-TSK-0630):

1. `git submodule update --init --recursive` when `.gitmodules` exists.
2. `session.worktree_setup` if configured (any shell command, cwd = the
   worktree); otherwise `npm ci` when `package-lock.json` exists.

Bootstrap is best-effort: failures warn and the lane continues — the
acceptance tests deliver the real verdict. Each lane keeps its own
`node_modules` (that IS the isolation; disk is the price).

## Budget governance

The launch gate (`parallel-limiter.js`) enforces:

- **Plan ceiling**: `max_parallel_hus × max_budget_usd` (default budget cap is
  5 USD per run, KJC-TSK-0621). When the shared tracker crosses it, no new
  lane launches and the run stops with `stopReason` — it never drains quota
  silently (the KJC-BUG-0107 class).
- **Semaphore**: at most `max_parallel_hus` lanes hold a slot at once.
- **Cooldown**: provider rate-limit signals pause new launches monotonically.

## Services per lane (ports, docker)

Each parallel lane gets a stable numeric slot (KJC-TSK-0631, registry at
`~/.karajan/worktree-slots.json`, released when the lane finishes). The
coder subprocess and the acceptance tests receive:

- `KJ_LANE_SLOT` — the lane's slot number (0, 1, …)
- `KJ_PORT_OFFSET` — `slot × 100`; apply it over your project's base port
  (e.g. `PORT=$((3000 + KJ_PORT_OFFSET))`)

Gotchas when your tests start real services (credit: Jorge del Casar's
worktree-docker-envs skill):

- **Dev-server client port**: Vite/webpack HMR announces the container's
  INTERNAL port to the browser. Pass the offset host port explicitly as an
  `environment:` variable and use it to override the dev server's client
  port — variables used only in `ports:` interpolation never reach the
  process inside the container.
- **Docker namespacing**: `docker compose -p "lane-$KJ_LANE_SLOT"` already
  namespaces containers/networks/volumes — no per-service renaming needed.
- **One-shot jobs vs `--wait`**: `docker compose up --wait` treats
  successfully-exited one-shot jobs (migrations, seeders) as failures.
  Use `up -d` plus polling the main service's healthcheck instead.

## Known limits

- `session` disk saves share one session id across lanes (last writer wins);
  in-memory isolation is what guards correctness. Journal entries may
  interleave.
- `ctx.stageResults` on the fallback (no acceptance tests) path is shared;
  plan-generated HUs always carry acceptance tests, which is the governed
  path.
- Recommended `--parallel` is 2–3: subscription rate limits, not CPU, are the
  real ceiling.

## Iteration gate (`--step`)

Independent of parallelism, `kj run --step` (or `session.iteration_gate:
true`, asked by `kj init`) pauses after every iteration with a compact report
(reviewer verdict, must-fix, next step, spend vs cap) and three choices:
continue, stop, or free text that is injected into the coder's next iteration
as a user directive (`appendUserDirective`, same channel as Solomon guidance).
Unattended runs pass through without pausing.
