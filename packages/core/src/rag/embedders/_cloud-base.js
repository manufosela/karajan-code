// KJC-TSK-0442 — shared POST helper for cloud embedders (OpenAI, Voyage).
// Same envelope: Bearer auth, JSON body shaped by caller, JSON response
// extracted by caller, dim validated against the adapter's expected size.
export async function cloudEmbed(adapter, text, ErrCls, { provider, body, extract }) {
  if (typeof text !== "string" || text.length === 0) throw new ErrCls("embed: text must be a non-empty string");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), adapter.timeoutMs);
  let res;
  try {
    res = await adapter.fetch(adapter.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adapter.apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) { throw new ErrCls(`${provider} embed request failed: ${err.message}`, { cause: err }); }
  finally { clearTimeout(timer); }
  if (!res.ok) throw new ErrCls(`${provider} embed HTTP ${res.status}`, { status: res.status });
  const json = await res.json();
  const arr = extract(json);
  if (!Array.isArray(arr) || arr.length === 0) throw new ErrCls(`${provider} response missing embedding`);
  if (arr.length !== adapter.dim) throw new ErrCls(`${provider} dim mismatch: got ${arr.length}, expected ${adapter.dim} for model ${adapter.model}`);
  return Float32Array.from(arr);
}
