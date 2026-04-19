/**
 * /api/pipeline/* — routes backing the pipeline observability view
 * (TSK-0325). Reads the session journal on every request; the UI polls
 * this endpoint every 1-2 s. No WebSocket, no SSE — polling keeps the
 * surface minimal and test-friendly.
 */

import { Router } from "express";
import { listSessions, readJournal } from "../journal-parser.js";

const router = Router();

/**
 * GET /api/pipeline/sessions
 * List every session with a journal directory. Most recent first.
 */
router.get("/sessions", (_req, res) => {
  try {
    const sessions = listSessions().map((s) => ({
      id: s.id,
      mtime: new Date(s.mtimeMs).toISOString(),
    }));
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/pipeline/sessions/:id
 * Full parsed journal for a given session.
 */
router.get("/sessions/:id", (req, res) => {
  try {
    const journal = readJournal(req.params.id);
    if (!journal.exists) {
      return res.status(404).json({ error: `session "${req.params.id}" not found` });
    }
    res.json(journal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
