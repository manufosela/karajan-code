import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Structural guard for the phone signer page (KJC-TSK-0822). The page is a
// static, self-contained capability page: everything inline, nothing external.
const pageUrl = new URL("../../apps/landing/public/sign/index.html", import.meta.url);
const html = readFileSync(pageUrl, "utf8");

describe("landing sign page", () => {
  it("has the enroll and approve sections", () => {
    expect(html).toContain('id="enroll"');
    expect(html).toContain('id="approve"');
  });

  // KJC-TSK-0998 (HUM-D): kj's why (what, why the signature, what if another did it) is shown before the files.
  it("shows the request's why before the files, hidden when the request carries none", () => {
    expect(html.indexOf('id="why"')).toBeLessThan(html.indexOf('id="files"'));
    expect(html).toMatch(/\$\("why"\)\.hidden = !str\(f\.why\)/);
  });

  // KJC-BUG-0563: *.js is cached for a year (immutable), so a changed helper needs a new URL or a phone keeps
  // the old one, the import of a new name fails and the page stays at "Cargando".
  it("imports the helper by a URL that changes with its content", () => {
    const helper = readFileSync(new URL("../../apps/landing/public/sign/sign-helpers.js", import.meta.url));
    const hash = createHash("sha256").update(helper).digest("hex").slice(0, 12);
    expect(html).toContain(`from "./sign-helpers.js?v=${hash}"`);
  });

  it("loads no external scripts, styles or resources", () => {
    expect(html).not.toMatch(/<script[^>]*\ssrc\s*=/i);
    expect(html).not.toMatch(/<link\s/i);
    expect(html).not.toMatch(/@import/);
  });

  // KJC-BUG-0432: the page said "signed" after kj had given up; past the request's expiry it refuses before signing.
  it("refuses to sign an expired request, before computing the signature", () => {
    const guard = html.indexOf("Date.now() >= expiresMs - SIGN_MARGIN_MS");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(html.indexOf('crypto.subtle.sign("Ed25519"'));
    expect(html).toMatch(/expired: "Esta petición ha caducado/);
    expect(html).toMatch(/expired: "This request has expired/);
  });

  // HU-3927 (ADR 0053): only a phone signs; there the passkey is the primary action, Ed25519 the secondary.
  it("on a desktop shows where to sign before touching any key, and offers the passkey first", () => {
    // KJC-BUG-0556: kj opens /sign without a trailing slash, so the relative import needs the page's base.
    expect(html).toContain('<base href="/sign/" />');
    expect(html).toMatch(/desktopBody: "Ábrela en el móvil: aquí no se firma"/);
    expect(html).toMatch(/desktopBody: "Open it on your phone: signing is not done here"/);
    const main = html.slice(html.indexOf("const main = async"));
    expect(main.indexOf('return show("desktop")')).toBeGreaterThan(-1);
    expect(main.indexOf('return show("desktop")')).toBeLessThan(main.indexOf("idbOp("));
    expect(html.indexOf('id="passkey-btn"')).toBeLessThan(html.indexOf('id="sign-btn"'));
    expect(html).toContain('if (!keys && !methods.includes("passkey")) return enrollMode(keys);'); // no flag: as on main
  });

  // HU-3976 (ADR 0053): a register request creates a passkey; only kind "register" reaches it, never on a desktop.
  it("reaches the register path only for kind register, after the desktop notice, and creates the passkey there", () => {
    expect(html).toMatch(/import \{ canonicalPayload, isPhone, passkeyChallenge, passkeyFields, passkeyRequest, registerFields, registerRequest, requestKind, signMethods \} from "\.\/sign-helpers\.js\?v=[0-9a-f]{12}"/);
    expect(html).toContain('id="register"');
    expect(html).toMatch(/register: "Crear passkey"/);
    expect(html).toMatch(/register: "Create passkey"/);
    const sign = html.slice(html.indexOf("const signMode = async"));
    const branch = sign.indexOf('if (requestKind(f) === "register") return registerMode(cid, f);');
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(sign.indexOf("signMethods("));
    expect(html.match(/registerMode\(/g)).toHaveLength(1); // the kind branch is its only caller
    const register = html.slice(html.indexOf("const registerMode = async"));
    expect(register).toContain("navigator.credentials.create({ publicKey: await registerRequest(");
    expect(register).toContain("registerFields(");
    const main = html.slice(html.indexOf("const main = async"));
    expect(main.indexOf('return show("desktop")')).toBeLessThan(main.indexOf("signMode("));
  });

  it("carries the public firebase api key and talks only to firestore", () => {
    expect(html).toContain("AIzaSyBEZ7CYkAgs1OQbFHeZIW_VVPAXMiIz1X8");
    expect(html).toContain(
      "https://firestore.googleapis.com/v1/projects/karajan-code/databases/(default)/documents/kjSupervisorSign"
    );
  });
});
