// C1.1 (KJC-TSK-0784, ADR 0007) — the gcs-jsonl audit sink: one IMMUTABLE
// object per entry in the bucket, named so that lexical order is chain order
// (zero-padded epoch ms, sequence, pid). The chain is rebuilt by listing and
// reading the objects in order; a failed upload rejects — the entry is never
// counted as sealed. Same injected Google auth as the gcp adapters.
const API = "https://storage.googleapis.com";

/**
 * @param {{bucket: string, prefix?: string, auth: {request: Function}, now?: () => number, pid?: number}} deps
 */
export function gcsSink({ bucket, prefix = "audit/", auth, now = Date.now, pid = process.pid }) {
  if (!bucket || typeof auth?.request !== "function") throw new TypeError("gcs-jsonl sink: bucket and auth.request are required");
  let lines = null;
  let seq = 0;
  const objectName = () => `${prefix}${String(now()).padStart(14, "0")}-${String(seq).padStart(6, "0")}-${pid}.json`;

  async function init() {
    if (lines) return lines;
    const names = [];
    let pageToken;
    do {
      const q = new URLSearchParams({ prefix, fields: "items(name),nextPageToken", ...(pageToken ? { pageToken } : {}) });
      const { data } = await auth.request({ url: `${API}/storage/v1/b/${bucket}/o?${q}`, method: "GET" });
      names.push(...(data.items || []).map((i) => i.name));
      pageToken = data.nextPageToken;
    } while (pageToken);
    names.sort();
    const loaded = [];
    for (const n of names) {
      const { data } = await auth.request({ url: `${API}/storage/v1/b/${bucket}/o/${encodeURIComponent(n)}?alt=media`, method: "GET", responseType: "text" });
      loaded.push(typeof data === "string" ? data.trim() : JSON.stringify(data));
    }
    lines = loaded;
    seq = names.length;
    return lines;
  }

  return {
    kind: "gcs-jsonl",
    async: true,
    init,
    lines: () => lines ?? [],
    async append(line) {
      if (!lines) await init();
      const name = objectName();
      seq += 1;
      await auth.request({ url: `${API}/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`, method: "POST", headers: { "content-type": "application/json" }, data: line });
      lines.push(line);
    },
  };
}
