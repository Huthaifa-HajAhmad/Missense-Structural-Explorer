import { describe, it, expect } from "vitest";
import {
  checkPayloadCompatibility,
  coreIdentityOf,
  payloadIdentityRecordOf,
  structuralIdentityRecordOf
} from "./core-identity.ts";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SCIENTIFIC IDENTITY OF A REQUEST — and the boundary no key crosses
 * ─────────────────────────────────────────────────────────────────────────────
 * Two rules are pinned here:
 *
 *   • the identity moves with everything that changes WHAT is modelled or WHICH providers answer,
 *     and with nothing else — so a shared run is never a different piece of evidence;
 *   • a persisted payload's identity record carries digests and booleans only. A payload that could
 *     be used to test a token guess would be a secret-verification oracle sitting in a database row
 *     for thirty days.
 */
const base: ParsedVariantContext = {
  gene: "PAH",
  variant: "p.Arg408Trp",
  uniprotId: "P00439",
  originalNotation: "p.Arg408Trp",
  acmgWeighting: "standard",
  sequence: "MKVLIVGLGNCGVFSLLDKN",
  pos: 408,
  residueIndex: "408",
  wildType: "Arg",
  mutant: "Trp",
  wt1Letter: "R",
  mut1Letter: "W",
  assembly: "GRCh38"
};

describe("coreIdentityOf", () => {
  it("is stable for the same request, and stable across a credential-free re-construction", () => {
    expect(coreIdentityOf({ ...base }).flightKey).toBe(coreIdentityOf({ ...base }).flightKey);
  });

  it("moves with each scientific dimension", () => {
    const baseKey = coreIdentityOf(base).flightKey;
    const variations: Partial<ParsedVariantContext>[] = [
      { gene: "GCH1" },
      { variant: "p.Arg408Gln" },
      { uniprotId: "P61457" },
      { sequence: "MKVLIVGLGNCGVFSLLDKM" },
      { pos: 409 },
      { acmgWeighting: "conservative" },
      { assembly: "GRCh37" },
      { genomicCoordinates: "1-1256452-C-A" },
      { liftedGenomicCoordinates: "1-1321072-C-A", resolvedAssembly: "GRCh38" },
      { numberingDisambiguated: true },
      // A different SpliceAI reporting window is a different score; it must not share an in-flight run.
      { spliceaiDistance: 500 }
    ];

    for (const variation of variations) {
      expect(coreIdentityOf({ ...base, ...variation }).flightKey, JSON.stringify(variation)).not.toBe(baseKey);
    }
  });

  it("moves with a provider capability, because that changes the evidence", () => {
    const baseKey = coreIdentityOf(base).flightKey;
    expect(coreIdentityOf({ ...base, biohubToken: "bh_x" }).flightKey).not.toBe(baseKey);
    expect(coreIdentityOf({ ...base, alphagenomeApiKey: "ag_x" }).flightKey).not.toBe(baseKey);
    expect(coreIdentityOf({ ...base, alphagenomeApiUrl: "https://example.org/ag" }).flightKey).not.toBe(baseKey);
  });

  /**
   * Endpoint A and endpoint B are different evidence sources, including when they share a host and
   * differ only in the query string — the case a boolean "a custom endpoint was used" cannot see.
   */
  it("separates two different custom endpoints, including two that differ only in the query", () => {
    const defaultEndpoint = coreIdentityOf({ ...base, alphagenomeApiUrl: undefined });
    const endpointA = coreIdentityOf({ ...base, alphagenomeApiUrl: "https://ag.example.org/scores" });
    const endpointB = coreIdentityOf({ ...base, alphagenomeApiUrl: "https://ag.example.org/other" });
    const tenantA = coreIdentityOf({ ...base, alphagenomeApiUrl: "https://ag.example.org/scores?tenant=A" });
    const tenantB = coreIdentityOf({ ...base, alphagenomeApiUrl: "https://ag.example.org/scores?tenant=B" });

    for (const identity of [endpointA, endpointB, tenantA, tenantB]) {
      expect(identity.flightKey).not.toBe(defaultEndpoint.flightKey);
    }
    expect(endpointA.flightKey).not.toBe(endpointB.flightKey);
    expect(tenantA.flightKey).not.toBe(tenantB.flightKey);
    expect(tenantA.flightKey).not.toBe(endpointA.flightKey);

    // ...and the PERSISTED digest carries the distinction without carrying the URL.
    expect(tenantA.capabilityHash).not.toBe(tenantB.capabilityHash);
    expect(tenantA.capabilityHash).not.toBe(endpointA.capabilityHash);
    expect(payloadIdentityRecordOf({ ...base, alphagenomeApiUrl: "https://ag.example.org/scores?tenant=A" }).capabilityHash)
      .not.toBe(payloadIdentityRecordOf({ ...base, alphagenomeApiUrl: "https://ag.example.org/scores?tenant=B" }).capabilityHash);
  });

  it("shares one run between two DIFFERENT credentials of the same kind (WP-I4), and never embeds either", () => {
    const withA = coreIdentityOf({ ...base, biohubToken: "bh_token_alpha" });
    const withB = coreIdentityOf({ ...base, biohubToken: "bh_token_beta" });

    // Whose token asked does not change the answer, so it does not change the key.
    expect(withA.flightKey).toBe(withB.flightKey);
    for (const key of [withA.flightKey, withB.flightKey, JSON.stringify(withA.capability)]) {
      expect(key).not.toContain("bh_token_alpha");
      expect(key).not.toContain("bh_token_beta");
    }
  });
});

describe("the persisted identity record", () => {
  it("carries digests and booleans only — never a token, a URL or a key-derived value", () => {
    const context: ParsedVariantContext = {
      ...base,
      biohubToken: "biohub_super_secret_value",
      alphagenomeApiKey: "ag_super_secret_value",
      alphagenomeApiUrl: "https://user:password@ag.example.org/score?key=embedded_secret"
    };

    const serialized = JSON.stringify(payloadIdentityRecordOf(context));

    for (const secret of [
      "biohub_super_secret_value",
      "ag_super_secret_value",
      "password",
      "embedded_secret",
      "example.org"
    ]) {
      expect(serialized, `${secret} must not reach a persisted row`).not.toContain(secret);
    }
    // It still says WHAT capability the run had, which is the part a reader needs.
    expect(payloadIdentityRecordOf(context).capabilityHash).toBe(payloadIdentityRecordOf(context).capabilityHash);
    expect(payloadIdentityRecordOf(context).capabilityHash).not.toBe(payloadIdentityRecordOf(base).capabilityHash);
  });

  it("records the same provider digest for the core and the structural scope", () => {
    // The structural scope mixed in the SaProt checkpoint until the language models were retired.
    expect(structuralIdentityRecordOf(base).capabilityHash).toBe(payloadIdentityRecordOf(base, "core").capabilityHash);
  });
});

describe("checkPayloadCompatibility", () => {
  const payloadFor = (context: ParsedVariantContext) => ({
    _internal: { coreIdentity: payloadIdentityRecordOf(context) }
  });

  /**
   * AN UNSTAMPED ROW IS NOT USABLE EVIDENCE.
   *
   * It records nothing to compare, so it could have been written for another build trail, weighting
   * or provider configuration, and there is no way to tell. It is refused, and the refetch that
   * follows stamps it — a one-time recompute per row, not a cache wipe.
   */
  it("refuses a payload that carries no identity record at all", () => {
    const verdict = checkPayloadCompatibility({ clinvar: {}, serviceStatus: {} }, base, "core");
    expect(verdict.compatible).toBe(false);
    expect(verdict.recorded).toBe(false);
    expect(verdict.reason).toContain("no server context identity");
  });

  it("refuses a payload whose identity block is present but unusable", () => {
    expect(checkPayloadCompatibility({ _internal: { coreIdentity: {} } }, base, "core").compatible).toBe(false);
    expect(checkPayloadCompatibility({ _internal: { coreIdentity: { scienceHash: "x" } } }, base, "core").compatible).toBe(false);
  });

  it("accepts a payload that records this exact context", () => {
    const verdict = checkPayloadCompatibility(payloadFor(base), base, "core");
    expect(verdict.compatible).toBe(true);
    expect(verdict.recorded).toBe(true);
  });

  it("refuses a payload resolved against a different endpoint, including a query-only difference", () => {
    const storedForTenantA = {
      _internal: { coreIdentity: payloadIdentityRecordOf({ ...base, alphagenomeApiUrl: "https://ag.example.org/scores?tenant=A" }) }
    };

    expect(
      checkPayloadCompatibility(storedForTenantA, { ...base, alphagenomeApiUrl: "https://ag.example.org/scores?tenant=B" }, "core").compatible,
      "a different tenant is a different evidence source"
    ).toBe(false);
    expect(
      checkPayloadCompatibility(storedForTenantA, { ...base }, "core").compatible,
      "the same row must not be replayed against the default endpoint either"
    ).toBe(false);
    expect(
      checkPayloadCompatibility(storedForTenantA, { ...base, alphagenomeApiUrl: "https://ag.example.org/scores?tenant=A" }, "core").compatible
    ).toBe(true);
  });

  it("refuses a payload for a different build trail, weighting, sequence or residue", () => {
    const stored = payloadFor(base);

    for (const variation of [
      { assembly: "GRCh37" as const },
      { acmgWeighting: "conservative" as const },
      { sequence: "MKVLIVGLGNCGVFSLLDKM" },
      { variant: "p.Arg408Gln" },
      { liftedGenomicCoordinates: "1-1321072-C-A", resolvedAssembly: "GRCh38" as const }
    ]) {
      const verdict = checkPayloadCompatibility(stored, { ...base, ...variation }, "core");
      expect(verdict.compatible, JSON.stringify(variation)).toBe(false);
      expect(verdict.reason).toBeTruthy();
    }
  });

  it("refuses a payload computed under a different capability set, in either direction", () => {
    const storedWithoutToken = payloadFor(base);
    expect(checkPayloadCompatibility(storedWithoutToken, { ...base, biohubToken: "bh_x" }, "core").compatible).toBe(false);

    const storedWithToken = payloadFor({ ...base, alphagenomeApiKey: "ag_x" });
    expect(checkPayloadCompatibility(storedWithToken, base, "core").compatible).toBe(false);
  });

  it("judges the structural scope by the structural record, and the core scope by the core one", () => {
    const stored = { _internal: { coreIdentity: payloadIdentityRecordOf(base, "core") } };
    // A row with no structural record has never been written by a structural run: core yes, structural no.
    expect(checkPayloadCompatibility(stored, base, "core").compatible).toBe(true);
    expect(checkPayloadCompatibility(stored, base, "structural").compatible).toBe(false);
    const both = { _internal: { ...stored._internal, structuralIdentity: structuralIdentityRecordOf(base) } };
    expect(checkPayloadCompatibility(both, base, "structural").compatible).toBe(true);
  });
});
