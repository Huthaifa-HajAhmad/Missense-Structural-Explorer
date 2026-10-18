import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluateShadowTiers,
  getShadowTierStats,
  resetShadowTierStats,
  runShadowTiers,
  shadowTiersEnabled,
  type ShadowDeps,
} from "./shadow-tiers.ts";
import type { ResolutionOutcome } from "./types.ts";

/** TP53 R175H as the live ladder serves it: MANE consequence, canonical numbering verified. */
const tc = { transcript_id: "ENST00000269305", mane_select: "NM_000546.6", hgvsp: "ENSP00000269305.4:p.Arg175His", gene_symbol: "TP53" };
const outcome = (over: Partial<ResolutionOutcome> = {}): ResolutionOutcome => ({
  consequence: { provider: "ensembl-vep", seq_region_name: "17", start: 7675088, allele_string: "C/T", transcript_consequences: [tc] },
  assembly: "GRCh38",
  attempts: [],
  usedFallback: false,
  cacheHit: false,
  proteinChangeFound: true,
  numbering: { status: "canonical", consequence: tc as any, canonicalAccession: "P04637" } as any,
  ...over,
});

const localRow = (o: Record<string, unknown> = {}) => ({ record: { gene: "TP53", pos: 175, aaref: "R", aaalt: "H", ...o } as any, basis: "mane" as const });
const protvarFound = (o: Record<string, unknown> = {}) => ({ status: "found" as const, gene: "TP53", accession: "P04637", position: 175, wt: "R", mut: "H", ...o });
const deps = (o: Partial<ShadowDeps> = {}): ShadowDeps => ({
  local: vi.fn(async () => localRow()),
  protvar: vi.fn(async () => protvarFound()),
  ...o,
});

describe("evaluateShadowTiers", () => {
  it("agrees when both rungs read the served change on their own numbering basis", async () => {
    const d = deps();
    const report = await evaluateShadowTiers(outcome(), d);
    expect(report).toMatchObject({ coordinate: "17-7675088-C-T", local: { verdict: "agree" }, protvar: { verdict: "agree" } });
    expect(d.local).toHaveBeenCalledWith("17", 7675088, "C", "T");
  });

  it("reports a local disagreement against the served MANE consequence", async () => {
    const report = await evaluateShadowTiers(outcome(), deps({ local: vi.fn(async () => localRow({ pos: 60, aaref: "S", aaalt: "F" })) }));
    expect(report?.local).toMatchObject({ verdict: "disagree", reading: { pos: 60, wt: "S", mut: "F" } });
  });

  it("does not count a local row whose gene is not MANE-numbered", async () => {
    const report = await evaluateShadowTiers(
      outcome(),
      deps({ local: vi.fn(async () => ({ ...localRow(), basis: "ensembl-canonical" as const })) })
    );
    expect(report?.local).toMatchObject({ verdict: "miss", detail: "basis ensembl-canonical" });
  });

  it("compares ProtVar with canonical numbering only, never with an unverified numbering", async () => {
    const unverified = outcome({ numbering: { status: "unverified", consequence: tc as any } as any });
    expect((await evaluateShadowTiers(unverified, deps()))?.protvar.verdict).toBe("no-reference");
    const remapped = outcome({ numbering: { status: "remapped", consequence: { ...tc, hgvsp: "p.Arg176His" } as any } as any });
    expect((await evaluateShadowTiers(remapped, deps()))?.protvar.verdict).toBe("disagree");
  });

  it("records a rung's failure as an error and still evaluates the other rung", async () => {
    const failing = deps({ protvar: vi.fn(async () => { throw new Error("HTTP 503"); }) });
    const report = await evaluateShadowTiers(outcome(), failing);
    expect(report).toMatchObject({ local: { verdict: "agree" }, protvar: { verdict: "error", detail: "HTTP 503" } });
  });

  it.each([
    ["GRCh37", outcome({ assembly: "GRCh37" })],
    ["an indel", outcome({ consequence: { ...outcome().consequence, allele_string: "CA/T" } })],
    ["no protein change", outcome({ proteinChangeFound: false })],
  ])("is out of scope for %s", async (_label, o) => {
    const d = deps();
    expect(await evaluateShadowTiers(o, d)).toBeNull();
    expect(d.local).not.toHaveBeenCalled();
  });
});

describe("runShadowTiers", () => {
  const saved = process.env.RESOLVER_SHADOW_TIERS;
  beforeEach(() => resetShadowTierStats());
  afterEach(() => {
    if (saved === undefined) delete process.env.RESOLVER_SHADOW_TIERS;
    else process.env.RESOLVER_SHADOW_TIERS = saved;
  });

  it("is off under tests unless switched on, and RESOLVER_SHADOW_TIERS=off always wins", () => {
    delete process.env.RESOLVER_SHADOW_TIERS;
    expect(shadowTiersEnabled()).toBe(false);
    process.env.RESOLVER_SHADOW_TIERS = "on";
    expect(shadowTiersEnabled()).toBe(true);
    process.env.RESOLVER_SHADOW_TIERS = "off";
    expect(shadowTiersEnabled()).toBe(false);
  });

  it("returns before any rung answers and counts the verdicts once they do", async () => {
    process.env.RESOLVER_SHADOW_TIERS = "on";
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const d = deps({ protvar: vi.fn(async () => { await gate; return protvarFound(); }) });
    runShadowTiers(outcome(), d);
    expect(getShadowTierStats()).toMatchObject({ inFlight: 1, evaluated: 0 });
    release();
    await vi.waitFor(() => expect(getShadowTierStats().evaluated).toBe(1));
    expect(getShadowTierStats()).toMatchObject({ inFlight: 0, local: { agree: 1 }, protvar: { agree: 1 } });
  });

  it("drops work beyond four in flight instead of queueing it", () => {
    process.env.RESOLVER_SHADOW_TIERS = "on";
    const never = deps({ protvar: vi.fn(() => new Promise<never>(() => {})) });
    for (let i = 0; i < 6; i++) runShadowTiers(outcome(), never);
    expect(getShadowTierStats()).toMatchObject({ inFlight: 4, skippedBusy: 2 });
  });
});
