import { describe, expect, it } from "vitest";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";
import {
  checkFallbackError,
  getQuotaCooldown,
  parseProviderResetMs,
  resolveCooldownMs,
} from "../../open-sse/services/accountFallback.js";

describe("provider reset-aware cooldown (#2879)", () => {
  it("parses Google/Antigravity retryDelay seconds", () => {
    expect(parseProviderResetMs('{"retryDelay":"1976.365s"}')).toBe(1976365);
  });

  it("parses absolute resets_at epoch seconds", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const resetSec = Math.floor(now / 1000) + 1800;
    expect(parseProviderResetMs(`{"resets_at":${resetSec}}`, now)).toBe(1800_000);
  });

  it("parses Retry-After seconds", () => {
    expect(parseProviderResetMs("Retry-After: 120")).toBe(120_000);
  });

  it("returns null when no reset signal is present", () => {
    expect(parseProviderResetMs("rate limit exceeded")).toBeNull();
  });

  it("floors provider reset below the static backoff", () => {
    const staticMs = getQuotaCooldown(1);
    expect(resolveCooldownMs(1, "Retry-After: 1")).toBe(staticMs);
  });

  it("caps huge provider resets at MAX_RATE_LIMIT_COOLDOWN_MS", () => {
    expect(resolveCooldownMs(1, '{"retryDelay":"99999s"}')).toBe(MAX_RATE_LIMIT_COOLDOWN_MS);
  });

  it("uses provider retryDelay for Antigravity rate-limit fallback", () => {
    const result = checkFallbackError(429, 'PERMISSION_DENIED rate limit retryDelay: "3600s"', 0, "antigravity");
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(3600_000);
  });

  it("keeps the 6h hard cap for provider-reported cooldowns", () => {
    expect(MAX_RATE_LIMIT_COOLDOWN_MS).toBe(6 * 60 * 60 * 1000);
  });
});
