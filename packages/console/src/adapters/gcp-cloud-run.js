// C1 (KJC-TSK-0777, ADR 0007) — the gcp-cloud-run adapter: corpus health
// through the service's private URL with the console SA's ID token, and
// people's access as the roles/run.invoker binding of THAT service (never the
// project). Google auth is injected: google-auth-library in production
// (createGoogleCloudAuth), a stub in tests. REST v2, no SDK.
const RUN = "https://run.googleapis.com/v2";
const INVOKER = "roles/run.invoker";

const serviceName = (c) => `projects/${c.project}/locations/${c.region}/services/${c.service}`;
const principalOf = (email) => `user:${String(email).toLowerCase()}`;

/**
 * @param {{auth: {request: Function, idToken: Function}}} deps
 *   request({url, method, data}) → {data} authenticated as the console SA;
 *   idToken(audience) → ID token minted for that audience.
 */
export function createCloudRunAdapter({ auth }) {
  if (typeof auth?.request !== "function" || typeof auth?.idToken !== "function") throw new TypeError("gcp-cloud-run: auth.request and auth.idToken are required");

  const service = async (corpus) => (await auth.request({ url: `${RUN}/${serviceName(corpus)}`, method: "GET" })).data;
  const policy = async (corpus) => (await auth.request({ url: `${RUN}/${serviceName(corpus)}:getIamPolicy`, method: "GET" })).data;
  const invokers = (pol) => (pol.bindings || []).find((b) => b.role === INVOKER) ?? null;

  /** Read-modify-write on the invoker binding only; the etag makes a concurrent edit fail loudly. */
  async function setInvokers(corpus, mutate) {
    const pol = await policy(corpus);
    const bindings = (pol.bindings || []).filter((b) => b.role !== INVOKER);
    const members = new Set(invokers(pol)?.members ?? []);
    const changed = mutate(members);
    if (members.size) bindings.push({ role: INVOKER, members: [...members].sort() });
    if (changed) await auth.request({ url: `${RUN}/${serviceName(corpus)}:setIamPolicy`, method: "POST", data: { policy: { ...pol, bindings } } });
    return changed;
  }

  return {
    name: "gcp-cloud-run",
    async health(corpus) {
      const svc = await service(corpus);
      if (!svc?.uri) throw new Error(`gcp-cloud-run: service ${corpus.service} has no uri (not deployed?)`);
      const url = `${svc.uri.replace(/\/$/, "")}${corpus.healthPath || "/health"}`;
      const token = await auth.idToken(svc.uri);
      const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) return { ok: false, corpus: corpus.id, uri: svc.uri, status: res.status, error: `health returned ${res.status}` };
      const body = await res.json().catch(() => ({}));
      return { ok: true, corpus: corpus.id, uri: svc.uri, ...body };
    },
    async listAccess(corpus) {
      return (invokers(await policy(corpus))?.members ?? []).filter((m) => m.startsWith("user:")).map((m) => m.slice(5));
    },
    async grant(corpus, email) {
      const p = principalOf(email);
      const changed = await setInvokers(corpus, (members) => (members.has(p) ? false : (members.add(p), true)));
      return { granted: email.toLowerCase(), changed };
    },
    async revoke(corpus, email) {
      const p = principalOf(email);
      const changed = await setInvokers(corpus, (members) => members.delete(p));
      return { revoked: changed };
    },
  };
}

/** Production auth: the console service account (ADC) through google-auth-library. */
export async function createGoogleCloudAuth() {
  const { GoogleAuth } = await import("google-auth-library");
  const ga = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await ga.getClient();
  return {
    request: (opts) => client.request(opts),
    idToken: async (audience) => (await ga.getIdTokenClient(audience)).idTokenProvider.fetchIdToken(audience),
  };
}
