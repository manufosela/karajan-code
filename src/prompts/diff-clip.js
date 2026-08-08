/**
 * diff-clip — KJC-BUG-0134 (issue #1381). A bare [TRUNCATED] marker inside
 * the diff body reads as file content: reviewers blamed whichever file the
 * cut landed in and rejected complete, untouched code (each false positive
 * costs a solomon round). The clip is DECLARED as the pipeline's own, kept
 * OUTSIDE the diff body, cut on a line boundary, and the reviewer is told
 * the diff is partial so it never reasons about the completeness of files
 * it cannot fully see. Shared by every prompt that hands a diff to an AI.
 */

export const DIFF_CLIP_CHARS = 12000;

/** @returns {{body: string, note: string|null}} note is null when no clip happened. */
export function clipDiff(diff, limit = DIFF_CLIP_CHARS) {
  if (!diff) return { body: "", note: null };
  if (diff.length <= limit) return { body: diff, note: null };
  const hard = diff.slice(0, limit);
  const nl = hard.lastIndexOf("\n");
  const body = nl > 0 ? hard.slice(0, nl) : hard;
  const omittedLines = diff.slice(body.length).split("\n").filter(Boolean).length;
  const note = [
    `NOTE FROM THE KJ PIPELINE (not part of the diff): the diff above was clipped by kj at ~${limit} characters — ${omittedLines} more line(s) exist but are NOT shown.`,
    "The cut is kj's, not the author's: no file in the working tree is truncated.",
    "Do not raise issues about incomplete or cut-off content, and do not reason about the completeness of files you cannot fully see. Review only what is visible.",
  ].join(" ");
  return { body, note };
}
