// HTTP client for Linear's GraphQL API. The key goes only in the Authorization header and never into an error.
import { BoardOfflineError, BoardRejectedError } from "./board-errors.js";

const URL = "https://api.linear.app/graphql";

export function createClient({ apiKey, fetch = globalThis.fetch }) {
  if (!apiKey) throw new BoardRejectedError("Linear needs the key in the LINEAR_API_KEY environment variable");
  const clean = (text) => String(text).split(apiKey).join("[redacted]");

  return async (query, variables = {}) => {
    let res;
    try {
      res = await fetch(URL, { method: "POST", headers: { "content-type": "application/json", authorization: apiKey }, body: JSON.stringify({ query, variables }) });
    } catch (err) {
      throw new BoardOfflineError(`Linear unreachable: ${clean(err.message)}`);
    }
    const rateLimited = () => new BoardOfflineError(`Linear rate limit: retry in ${res.headers.get("retry-after") ?? "unknown"} seconds`);
    if (res.status === 429) throw rateLimited();
    if (res.status >= 500) throw new BoardOfflineError(`Linear unreachable: HTTP ${res.status}`);
    if (res.status === 401 || res.status === 403) throw new BoardRejectedError(`Linear refused the key (HTTP ${res.status})`);
    const body = await res.json().catch((e) => (e instanceof SyntaxError ? {} : Promise.reject(new BoardOfflineError(`Linear unreachable: ${clean(e.message)}`))));
    if (body.errors?.some((e) => e.extensions?.code === "RATELIMITED")) throw rateLimited();
    if (body.errors?.length) throw new BoardRejectedError(`Linear refused the request: ${clean(body.errors.map((e) => e.message).join("; "))}`);
    if (!res.ok || !body.data) throw new BoardRejectedError(`Linear answered HTTP ${res.status} without data`);
    return body.data;
  };
}
