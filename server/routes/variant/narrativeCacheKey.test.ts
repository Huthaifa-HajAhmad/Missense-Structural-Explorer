import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { NARRATIVE_PROMPT_SCHEMA_VERSION } from "../../../src/shared/narrativeSynthesis.ts";

/**
 * Guardrail: the narrative cache key carries the PROMPT's version, from one declaration.
 *
 * WHY THIS EXISTS
 * ---------------
 * `narrativeCache` is an in-process LRU with a 24-hour TTL. The synthesis cache key is otherwise a
 * pure function of the request — variant, weighting, clinician directions, an evidence hash, the API
 * key and the model — so re-running the same variant with the same evidence produces the same key and
 * is served a cached narrative.
 *
 * The prompt was changed to stop the model inventing a ClinVar classification for a variant ClinVar
 * does not hold. Without a version bump, every variant already in the cache would have kept serving
 * the narrative written under the old prompt for up to a day — a fix that is real in the code and
 * invisible to the user, which is the failure mode this guard exists to prevent. The key's
 * `_schema:v2` marker had already been left behind by earlier prompt edits.
 *
 * WHAT THIS CHECKS
 * ----------------
 * The key interpolates the shared constant rather than a literal. That is the whole mechanism: the
 * version lives beside the prompt in `src/shared/narrativeSynthesis.ts`, and a literal here would
 * let the two drift — the route would keep serving version 2 while the prompt moved on.
 *
 * It deliberately does NOT try to detect "the prompt changed and nobody bumped the constant". That is
 * not mechanically decidable from the prompt's source (it is assembled from a dozen interpolated
 * evidence blocks), so the constant carries the instruction and this guard carries the wiring.
 */

const REPO_ROOT = process.cwd();
const NARRATIVE_ROUTE = path.join(REPO_ROOT, "server", "routes", "variant", "narrative.ts");

/** Matches `_schema:v2`, `_schema:v3`, `_schema:${anything}` inside a template literal. */
const SCHEMA_SEGMENT = /_schema:v(\d+|\$\{[^}]*\})/g;

describe("narrative synthesis cache key", () => {
  const source = fs.readFileSync(NARRATIVE_ROUTE, "utf-8");

  /** The line that builds the key, so assertions are about the producer and not the whole file. */
  const keyLine = source
    .split(/\r?\n/)
    .find(line => line.includes("const cacheKey = ") && line.includes("clinical_"));

  it("finds the cache key it is meant to guard", () => {
    // Without this, a rename would make every assertion below vacuous.
    expect(keyLine, "narrative.ts must still build a `clinical_` cache key").toBeTruthy();
  });

  it("takes the schema version from the shared constant, not a literal", () => {
    const segments = [...keyLine!.matchAll(SCHEMA_SEGMENT)].map(m => m[0]);
    expect(segments, "the key must carry exactly one _schema: segment").toHaveLength(1);
    expect(segments[0]).toContain("NARRATIVE_PROMPT_SCHEMA_VERSION");
    // The positive control for the negative below: a literal is what we must NOT have.
    expect(segments[0]).not.toMatch(/_schema:v\d+$/);
  });

  it("cannot silently pin an old version", () => {
    const literalVersions = [...keyLine!.matchAll(/_schema:v(\d+)/g)].map(m => Number(m[1]));
    expect(
      literalVersions,
      `the key hard-codes schema v${literalVersions.join(", v")} instead of interpolating ` +
        `NARRATIVE_PROMPT_SCHEMA_VERSION — a prompt change would then keep serving old narratives ` +
        `from the 24h cache`
    ).toEqual([]);
  });

  it("declares a version that is a positive integer", () => {
    expect(Number.isInteger(NARRATIVE_PROMPT_SCHEMA_VERSION)).toBe(true);
    expect(NARRATIVE_PROMPT_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
