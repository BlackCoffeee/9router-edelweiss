#!/usr/bin/env node
/**
 * verify-lockfile-npm10.mjs
 *
 * GUARD — DO NOT DELETE.
 *
 * Why this exists (root cause, 2026-09-19):
 *   The Docker image pins `node:22-alpine` by digest, which ships npm 10.9.8.
 *   The repo's `package-lock.json` is tracked (upstream does NOT track it) and
 *   the Dockerfile runs `npm ci`. If the lockfile is regenerated with npm 11+,
 *   npm 11 DROPS the top-level optional entries `@emnapi/core` and
 *   `@emnapi/runtime` that npm 10 requires for its platform-complete resolve.
 *   The tag-triggered "Build and Push Docker Image" workflow then fails at
 *   `npm ci` with:
 *       Missing: @emnapi/runtime@<v> from lock file
 *       Missing: @emnapi/core@<v> from lock file
 *   This already happened once on tag v1.0.14.
 *
 * Rule: ALWAYS regenerate package-lock.json with npm 10.x (the version Docker
 * uses), never with the developer's global npm 11+.
 *
 *   Correct:   npx -y npm@10.9.8 install --package-lock-only
 *   Wrong:     npm install            # global npm 11+ silently breaks Docker
 *
 * This script asserts the lockfile still carries the entries npm 10 needs.
 * Wire it into CI / pre-commit; exit 1 = lockfile will break the Docker build.
 *
 * Usage: node scripts/verify-lockfile-npm10.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const lockPath = join(here, "..", "package-lock.json");

let lock;
try {
  lock = JSON.parse(readFileSync(lockPath, "utf8"));
} catch (err) {
  console.error(`❌ Cannot read ${lockPath}: ${err.message}`);
  process.exit(1);
}

const packages = lock.packages || {};
const required = ["node_modules/@emnapi/core", "node_modules/@emnapi/runtime"];
const missing = required.filter((key) => !packages[key]);

if (missing.length > 0) {
  console.error(
    [
      "❌ package-lock.json is NOT npm-10-compatible — the Docker build will fail at `npm ci`.",
      "",
      `   Missing top-level entries: ${missing.join(", ")}`,
      "",
      "   Cause: the lockfile was regenerated with npm 11+, which drops the",
      "   top-level @emnapi entries that npm 10 (node:22-alpine in the Docker image) requires.",
      "",
      "   Fix (run from repo root):",
      "     npx -y npm@10.9.8 install --package-lock-only",
      "   Then re-run: node scripts/verify-lockfile-npm10.mjs",
      "",
      "   Do NOT use your global `npm install` to regenerate the lockfile.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `✅ package-lock.json is npm-10-compatible (found ${required.join(", ")}). Docker \`npm ci\` will succeed.`,
);
