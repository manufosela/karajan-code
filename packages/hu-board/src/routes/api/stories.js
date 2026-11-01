// KJC-TSK-0541: the story (HU) endpoints of /api, composed by routes/api.js.
import { Router } from 'express';

import { getStoriesByProject, getStoryDetail, getStoryRow } from '../../db.js';
import { setHuStatus, setHuFields } from '../../plan-mutations.js';

const router = Router();

/**
 * GET /api/projects/:id/stories - Stories for a project.
 */
router.get('/projects/:id/stories', (req, res) => {
  try {
    const stories = getStoriesByProject(req.params.id);
    res.json(stories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stories/:id - Story detail with quality scores and context requests.
 */
router.get('/stories/:id', (req, res) => {
  try {
    const story = getStoryDetail(req.params.id);
    if (!story) return res.status(404).json({ error: 'Story not found' });
    res.json(story);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/stories/:id - Refused: stories are never deleted (KJC-TSK-0671).
 */
router.delete('/stories/:id', (req, res) => {
  // KJC-TSK-0671 (absolute product rule): stories are NEVER deleted — the
  // delete-and-recreate "fix" agents improvise loses history and produced
  // the field saga this closes. Discard goes through the lifecycle instead.
  res.status(405).json({
    error: 'Stories are never deleted. Discard one with: kj hu move <id> skipped '
      + '(archived, history kept). Dashboard warnings are fixed with the command '
      + 'they name — see kj brief board.',
  });
});

/**
 * PATCH /api/stories/:id - Edit a single HU.
 *
 * Accepts two shapes in the same call (both optional, either or both
 * can be present):
 *
 *   { status: "pending" | "certified" | "done" | "needs_context" }
 *     → changes the lifecycle state (original PATCH semantics).
 *
 *   { title?, scope?, task_type?, acceptance_criteria?,
 *     acceptance_tests?, blocked_by? }
 *     → edits the user-facing fields in place. Whitelist mirrors
 *     plan-hu-ops::updateHu so CLI and board stay aligned.
 *
 * When both are present we apply status last — the status change
 * transitions the plan lifecycle and can rewrite plan.status, whereas
 * field edits are local to the HU and should never fight the status
 * auto-promotion.
 *
 * The row id on the board is `${projectId}::${huId}` — split here to
 * feed the plan-mutation helpers. The source-of-truth plan JSON is
 * rewritten before we ack, then re-synced into SQLite, so a reload
 * renders the committed state.
 */
// KJC-TSK-0394 PR6 (AC 6): el PATCH endpoint sólo acepta el modelo
// canónico {pending, running, done}. Status legacy (`certified`,
// `coding`, `reviewing`, `failed`, `blocked`, `needs_context`) siguen
// vivos en plans existentes y los traduce la UI con canonicalStatus(),
// pero NO pueden ser seteados por escrituras nuevas — devolvemos 400
// con `suggestion` apuntando al mapping correcto. `running` queda fuera
// del dropdown del modal (lifecycle del orquestador), pero el endpoint
// lo acepta por si un programa externo lo necesita.
const ALLOWED_STORY_STATUSES = new Set(['pending', 'running', 'done']);
// Mapping canónico para la sugerencia del 400 cuando el caller manda
// un valor legacy. Mantenemos la regla viva en src/plan/plan-schema.js
// (mapLegacyStatusToResult) — esta tabla es sólo el subset accionable
// desde el endpoint (status + result).
const LEGACY_STATUS_SUGGESTION = {
  certified: { status: 'done', result: 'pass' },
  failed: { status: 'pending', result: 'fail' },
  coding: { status: 'running', result: null },
  reviewing: { status: 'running', result: null },
  blocked: { status: 'pending', result: null },
  needs_context: { status: 'pending', result: null },
};
// KJC-TSK-0406: coder_model y reviewer_model son editables desde el
// modal del board. Independientes — el usuario puede subir el reviewer
// y bajar el coder sin afectar al resto del plan.
// KJC-PRP-0002 PR6: `assignee` is editable from the board modal when the
// project is team-shared. The whitelist itself is project-agnostic — the
// modal hides the input on non-shared projects, but accepting the field
// here doesn't hurt (sync just stores it).
const EDITABLE_HU_FIELDS = ['title', 'scope', 'task_type', 'acceptance_criteria', 'acceptance_tests', 'blocked_by', 'coder_model', 'reviewer_model', 'coder_provider', 'reviewer_provider', 'assignee'];

router.patch('/stories/:id', (req, res) => {
  try {
    const body = req.body || {};
    const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');
    const fieldPatch = {};
    for (const k of EDITABLE_HU_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, k)) fieldPatch[k] = body[k];
    }
    const hasFieldEdit = Object.keys(fieldPatch).length > 0;

    if (!hasStatus && !hasFieldEdit) {
      return res.status(400).json({
        error: `Body must include status or one of: ${EDITABLE_HU_FIELDS.join(', ')}`,
      });
    }
    if (hasStatus && !ALLOWED_STORY_STATUSES.has(body.status)) {
      // KJC-TSK-0394 PR6 (AC 6): si el caller manda un status legacy,
      // devolvemos un 400 con `suggestion` apuntando al mapping canónico.
      // Una herramienta externa puede leer el body, aplicar el mapeo y
      // re-intentar — sin tener que descubrir la tabla por ensayo y error.
      const suggestion = LEGACY_STATUS_SUGGESTION[body.status] || null;
      return res.status(400).json({
        error: `status must be one of: ${[...ALLOWED_STORY_STATUSES].join(', ')}`,
        suggestion,
      });
    }

    const row = getStoryRow(req.params.id);
    if (!row) return res.status(404).json({ error: 'Story not found' });
    if (!row.plan_id) {
      return res.status(409).json({
        error: 'Story is not backed by a plan file (legacy row). Re-run `kj plan` to re-import it.',
      });
    }
    const huId = req.params.id.includes('::')
      ? req.params.id.split('::').slice(1).join('::')
      : req.params.id;

    let updatedHu;
    if (hasFieldEdit) {
      const fieldResult = setHuFields({
        planId: row.plan_id,
        huId,
        patch: fieldPatch,
        projectId: row.project_id,
      });
      if (!fieldResult.ok) {
        // KJC-TSK-0401: validación de blocked_by devuelve 400 con cycle?
        // info para que el board destaque la cadena en la UI. Resto de
        // fallos siguen devolviendo 404 (plan / hu no encontrados).
        if (fieldResult.code === 'INVALID_BLOCKED_BY') {
          return res.status(400).json({ error: fieldResult.error, cycle: fieldResult.cycle });
        }
        return res.status(404).json({ error: fieldResult.error });
      }
      updatedHu = fieldResult.hu;
    }

    let statusResult;
    if (hasStatus) {
      statusResult = setHuStatus({
        planId: row.plan_id,
        huId,
        status: body.status,
        projectId: row.project_id,
      });
      if (!statusResult.ok) return res.status(404).json({ error: statusResult.error });
    }

    res.json({
      updated: true,
      id: req.params.id,
      status: statusResult ? statusResult.status : undefined,
      planStatus: statusResult ? statusResult.planStatus : undefined,
      hu: updatedHu,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
