import { describe, expect, it } from "vitest";

const { buildClineHeaders } = await import("../../open-sse/shared/clineAuth.js");

// Envelope-unwrap behavior for non-streaming responses is covered by the
// upstream, opt-in mechanism instead: see unwrapClineEnvelope()
// (open-sse/shared/clineEnvelope.js) and tests/unit/cline-free-models-envelope.test.js.
// A generic unconditional unwrap was removed during the v0.5.86 sync because it
// rewrote non-opted-in providers' bodies, breaking the opt-in contract that
// test pins ("leaves an enveloped body untouched for a provider that did not
// opt in"). This file retains the auth-header coverage (buildClineHeaders is
// the only path that sets the Cline free-model gate headers).

describe("cline auth header shape", () => {
  it("sends API keys as plain Bearer", () => {
    expect(buildClineHeaders("sk_abc", {}, { isApiKey: true }).Authorization).toBe("Bearer sk_abc");
  });

  it("prefixes WorkOS JWT OAuth tokens with workos:", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig";
    expect(buildClineHeaders(jwt).Authorization).toBe(`Bearer workos:${jwt}`);
    expect(buildClineHeaders(`workos:${jwt}`).Authorization).toBe(`Bearer workos:${jwt}`);
  });

  it("does not workos:-prefix opaque tokens (API keys, clp_…)", () => {
    expect(buildClineHeaders("tok123").Authorization).toBe("Bearer tok123");
    expect(buildClineHeaders("clp_abc123").Authorization).toBe("Bearer clp_abc123");
  });

  it("sends Cline product identity headers (free-model gate)", () => {
    const h = buildClineHeaders("tok123");
    expect(h["X-CLIENT-TYPE"]).toBe("cline-cli");
    expect(h["User-Agent"]).toMatch(/^Cline\//);
  });
});
