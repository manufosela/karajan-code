/**
 * Security utilities for the proxy layer.
 *
 * - sanitizeHeaders: strips sensitive values before logging
 * - isRequestTooLarge: checks Content-Length against a limit
 *
 * @module proxy/security
 */

/** Headers whose values must never appear in logs. */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "x-goog-api-key",
]);

/**
 * Return a shallow copy of `headers` with sensitive values replaced by "[REDACTED]".
 *
 * @param {Record<string, string>} headers
 * @returns {Record<string, string>}
 */
export function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};

  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }
  return result;
}

/**
 * Check whether the declared Content-Length exceeds the allowed maximum.
 *
 * @param {number|string|undefined} contentLength - Value of the content-length header
 * @param {number} maxBytes - Maximum allowed body size in bytes (default 50 MB)
 * @returns {boolean} true if the request is too large
 */
export function isRequestTooLarge(contentLength, maxBytes = 50 * 1024 * 1024) {
  if (contentLength == null) return false;
  const len = Number(contentLength);
  if (Number.isNaN(len)) return false;
  return len > maxBytes;
}
