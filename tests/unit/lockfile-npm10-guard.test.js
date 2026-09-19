// GUARD — DO NOT DELETE. See AGENTS.md §1.
//
// The Docker image (node:22-alpine, pinned by digest) ships npm 10.9.8 and runs
// `npm ci` against the committed package-lock.json. Regenerating the lockfile
// with npm 11+ drops the top-level @emnapi/core + @emnapi/runtime entries npm 10
// requires, breaking the tag-triggered Docker build at `npm ci` (already
// happened on tag v1.0.14).
//
// Regenerate the lockfile with npm 10 only:
//   npx -y npm@10.9.8 install --package-lock-only
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const lock = JSON.parse(readFileSync(join(here, "..", "..", "package-lock.json"), "utf8"));

describe("package-lock.json is npm-10-compatible (Docker npm ci)", () => {
  it("keeps the top-level @emnapi/core entry npm 10 requires", () => {
    expect(lock.packages?.["node_modules/@emnapi/core"]).toBeTruthy();
  });

  it("keeps the top-level @emnapi/runtime entry npm 10 requires", () => {
    expect(lock.packages?.["node_modules/@emnapi/runtime"]).toBeTruthy();
  });

  it("stays on lockfileVersion 3", () => {
    expect(lock.lockfileVersion).toBe(3);
  });
});
