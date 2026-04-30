/**
 * Extracted from `src/orchestrator/drivers/pre-loop.js` in TSK-0337
 * (audit recommendation #6). Previously a 60-line export inside
 * pre-loop.js; moved here to keep that driver under the 600-LOC
 * ceiling its own docstring set. Behaviour and signature unchanged.
 *
 * Refreshes the addyosmani/agent-skills catalog (clones or pulls,
 * gated by `refreshDays`) and resolves which slugs are relevant to
 * the current task. Sets the result on the session via the
 * `setAddyosmaniSkills` mutator so downstream stages can read it
 * without re-running git.
 *
 * Failures are non-blocking: a missing git, a network blip, or an
 * unparseable catalog all just mark the catalog unavailable and
 * emit a `skills:addyosmani-unavailable` event. The pipeline keeps
 * going — the addyosmani sources are an optional supplement.
 */

import {
  refreshIfStale as refreshAddyosmaniCatalog,
  listAvailableSlugs as listAddyosmaniSlugs,
} from "../../../skills/addyosmani-catalog.js";
import { resolveAddyosmaniSlugs } from "../../../skills/addyosmani-role-map.js";
import { setAddyosmaniSkills } from "../../../session/mutators.js";
import { emitProgress, makeEvent } from "../../../utils/events.js";

export async function ensureAddyosmaniSkills({ task, config, logger, session, emitter, eventBase }) {
  const skillsConfig = config?.skills || {};
  const sources = Array.isArray(skillsConfig.sources) ? skillsConfig.sources : ["addyosmani", "openskills", "local"];
  const addyConfig = skillsConfig.addyosmani || {};
  // Test harness override: config.testHarness.defaultAddyosmaniEnabled=false
  // prevents orchestrator tests from spawning git. Tests that need the real
  // catalog opt in by setting config.skills.addyosmani.enabled = true.
  // Post-v2.7.5 no longer reads globalThis directly — config.testHarness is
  // populated by the loader from the global or the production default.
  const harnessDefault = config?.testHarness?.defaultAddyosmaniEnabled;
  const enabledFromConfig = addyConfig.enabled === true
    || (addyConfig.enabled !== false && harnessDefault !== false);
  const enabled = enabledFromConfig && sources.includes("addyosmani");
  if (!enabled) return;

  const refreshDays = Number.isFinite(addyConfig.refreshDays) ? addyConfig.refreshDays : 7;
  const refreshMs = Math.max(0, refreshDays) * 24 * 60 * 60 * 1000;

  try {
    const refreshResult = await refreshAddyosmaniCatalog({
      refreshMs,
      repoUrl: addyConfig.repoUrl,
      logger,
    });

    if (!refreshResult.ok) {
      setAddyosmaniSkills(session, { available: false, reason: refreshResult.error || "refresh failed" });
      emitProgress(emitter, makeEvent("skills:addyosmani-unavailable", { ...eventBase, stage: "skills" }, {
        message: `addyosmani/agent-skills catalog unavailable: ${refreshResult.error || refreshResult.action}`,
        detail: { action: refreshResult.action, hint: "Install git to enable process skills from addyosmani/agent-skills" },
      }));
      return;
    }

    const available = new Set(await listAddyosmaniSlugs());
    const resolved = resolveAddyosmaniSlugs({ role: null, task }); // role resolution happens per-stage later
    const valid = resolved.filter((slug) => available.has(slug));

    setAddyosmaniSkills(session, {
      available: true,
      action: refreshResult.action,
      resolvedSlugs: valid,
      allAvailable: Array.from(available),
    });

    emitProgress(emitter, makeEvent("skills:addyosmani-ready", { ...eventBase, stage: "skills" }, {
      message: `addyosmani/agent-skills ${refreshResult.action} — ${available.size} slug(s) available, ${valid.length} relevant to task`,
      detail: {
        action: refreshResult.action,
        relevantSlugs: valid,
        availableCount: available.size,
      },
    }));
  } catch (err) {
    logger.warn(`addyosmani catalog step failed (non-blocking): ${err.message}`);
    setAddyosmaniSkills(session, { available: false, reason: err.message });
  }
}
