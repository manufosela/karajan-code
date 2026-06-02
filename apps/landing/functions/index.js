/**
 * Karajan Code telemetry endpoint.
 *
 * Receives opt-in anonymous events from `karajan-code` CLIs and persists
 * them to the `telemetry` Firestore collection. Client-side reads/writes
 * are denied by `firestore.rules`; only this function (Admin SDK) writes.
 *
 * The client side is intentionally fire-and-forget with a 3s timeout, so
 * this function must:
 *   - Validate cheaply (no schema libs, no async checks before write).
 *   - Return 204 on success — no body, nothing for the client to parse.
 *   - Never echo the payload back; we don't want to leak data via reflection.
 *
 * See ../../karajan-code/src/utils/telemetry.js for the emitter contract
 * and the "Privacy & telemetry" section of its README for the user-facing
 * promise.
 */

import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();

const MAX_BODY_BYTES = 10_000;
const ALLOWED_EVENTS = new Set(["install", "cli_command", "pipeline_complete"]);

function isValidPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (!ALLOWED_EVENTS.has(payload.event)) return false;
  if (typeof payload.v !== "string" || payload.v.length > 32) return false;
  if (typeof payload.ts !== "number" || !Number.isFinite(payload.ts)) return false;
  return true;
}

export const telemetry = onRequest(
  { region: "us-central1", cors: false, maxInstances: 10 },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).set("Allow", "POST").end();
      return;
    }

    const rawSize = Number(req.headers["content-length"] || 0);
    if (rawSize > MAX_BODY_BYTES) {
      res.status(413).end();
      return;
    }

    const payload = req.body;
    if (!isValidPayload(payload)) {
      res.status(400).end();
      return;
    }

    try {
      await db.collection("telemetry").add({
        ...payload,
        received_at: FieldValue.serverTimestamp(),
      });
      res.status(204).end();
    } catch (err) {
      // Server-side log only — client never sees the reason.
      console.error("[telemetry] write failed:", err.message);
      res.status(500).end();
    }
  }
);
